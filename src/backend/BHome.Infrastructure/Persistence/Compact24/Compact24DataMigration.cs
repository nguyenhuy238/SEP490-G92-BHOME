using System.Data;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Jobs;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed record Compact24Reconciliation(string Source, long SourceRows, long TargetRecords, bool KeysAndValuesMatch);
public sealed record Compact24DataCopyResult(IReadOnlyList<Compact24Reconciliation> Tables, bool Committed, bool SourceReadOnly);

// Offline only: both connections must identify explicitly named, disposable/authorized databases.
// Uses the same typed serialization and native columns as runtime, with historical timestamps preserved.
public sealed class Compact24DataMigration(BHomeDbContext source, Compact24DbContext target, int maximumRowsPerTable = 10000)
{
    private static readonly HashSet<string> IdentityTables = new(StringComparer.Ordinal)
    { "AspNetUsers", "AspNetRoles", "AspNetUserRoles", "AuthenticationSessions", "RefreshTokens", "PasswordResetGrants", "SecurityAudit", "Chains" };
    private static readonly HashSet<string> UnsupportedIdentityExtensions = new(StringComparer.Ordinal)
    { "AspNetRoleClaims", "AspNetUserClaims", "AspNetUserLogins", "AspNetUserTokens" };

    public async Task<Compact24MigrationInspection> InspectAsync(CancellationToken token = default)
    {
        var inspector = new Compact24FixtureMigration(source, target); inspector.ValidateConnections();
        if (maximumRowsPerTable <= 0) throw new Compact24MigrationException("positive_copy_limit_required");
        await using var read = await source.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        await source.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", token);
        return FullInspection(await inspector.InspectSnapshotAsync(token, maximumRowsPerTable));
    }

    private static Compact24MigrationInspection FullInspection(Compact24MigrationInspection inspection) => new(inspection.Tables,
        inspection.Blockers.Where(b => !b.StartsWith("unsupported_source_rows:", StringComparison.Ordinal)).Concat(
            inspection.Tables.Where(t => t.Rows > 0 && UnsupportedIdentityExtensions.Contains(t.Source))
                .Select(t => "identity_extension_behavior_requires_mapping_decision:" + t.Source)).ToArray());

    public async Task<Compact24DataCopyResult> CopyAsync(CancellationToken token = default)
    {
        var identity = new Compact24FixtureMigration(source, target);
        identity.ValidateConnections();
        await using var read = await source.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        await source.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", token);
        if (maximumRowsPerTable <= 0) throw new Compact24MigrationException("positive_copy_limit_required");
        var inspection = FullInspection(await identity.InspectSnapshotAsync(token, maximumRowsPerTable));
        if (inspection.Blockers.Count != 0)
            throw new Compact24MigrationException("source_preflight_failed");
        if (inspection.Tables.Any(t => UnsupportedIdentityExtensions.Contains(t.Source) && t.Rows != 0))
            throw new Compact24MigrationException("identity_extension_behavior_requires_mapping_decision");

        // One target transaction includes Identity, business rows and reconciliation. No partial copy.
        await using var write = await target.Database.BeginTransactionAsync(token);
        await identity.CopyIdentitySnapshotAsync(true, token, maximumRowsPerTable);
        target.Importing = true;
        try
        {
            var entities = source.Model.GetEntityTypes().Where(e => !IdentityTables.Contains(e.GetTableName()!) &&
                !UnsupportedIdentityExtensions.Contains(e.GetTableName()!)).ToArray();
            var rows = new Dictionary<Type, object[]>();
            foreach (var entity in entities)
            {
                _ = Compact24Records.For(entity.ClrType); // An unimplemented mapping is a hard error, including an empty source table.
                rows.Add(entity.ClrType, await ReadRowsAsync(source, entity.ClrType, token));
            }
            var recipients = rows[typeof(InvoiceRecipient)].Cast<InvoiceRecipient>().ToLookup(r => r.InvoiceId);
            foreach (var invoice in rows[typeof(Invoice)].Cast<Invoice>()) invoice.Recipients = recipients[invoice.Id].ToList();
            foreach (var batch in rows.Values) target.AddRange(batch);
            await target.SaveChangesAsync(token);
            // Final invoices must first be inserted as Draft so their original lines and entitlements
            // can be restored under the unchanged target immutability triggers.
            foreach (var invoice in rows[typeof(Invoice)].Cast<Invoice>().Where(i => i.Status == InvoiceStatus.Final))
                await target.Database.ExecuteSqlInterpolatedAsync($"UPDATE invoices SET status=1 WHERE id={invoice.Id} AND status=0", token);
            target.ChangeTracker.Clear();

            var reconciliation = new List<Compact24Reconciliation>();
            foreach (var entity in entities)
            {
                var expected = rows[entity.ClrType];
                var actual = await ReadRowsAsync(target, entity.ClrType, token);
                var match = Fingerprints(entity, expected).SequenceEqual(Fingerprints(entity, actual));
                reconciliation.Add(new(entity.GetTableName()!, expected.LongLength, actual.LongLength, match));
                if (!match) throw new Compact24MigrationException("reconciliation_failed:" + entity.GetTableName());
            }
            // Identity copier verifies every user field, role, reset grant, session, token and audit UUID/time.
            // Re-read their domain audit/chain projections to validate historical scalar fields too.
            foreach (var type in new[] { typeof(SecurityAuditRecord), typeof(BHome.Domain.PropertyManagement.Chain) })
            {
                var metadata = source.Model.FindEntityType(type)!;
                var expected = await ReadRowsAsync(source, type, token);
                var actual = await ReadRowsAsync(target, type, token);
                if (!Fingerprints(metadata, expected).SequenceEqual(Fingerprints(metadata, actual)))
                    throw new Compact24MigrationException("reconciliation_failed:" + metadata.GetTableName());
            }
            foreach (var table in inspection.Tables.Where(t => IdentityTables.Contains(t.Source) || UnsupportedIdentityExtensions.Contains(t.Source)))
                reconciliation.Add(new(table.Source, table.Rows, table.Rows, true));
            if (reconciliation.Count != 70 || reconciliation.Any(r => !r.KeysAndValuesMatch))
                throw new Compact24MigrationException("incomplete_reconciliation");
            await write.CommitAsync(token);
            return new(reconciliation.OrderBy(r => r.Source, StringComparer.Ordinal).ToArray(), true, true);
        }
        finally { target.Importing = false; target.ChangeTracker.Clear(); }
    }

    private static Task<object[]> ReadRowsAsync(DbContext db, Type type, CancellationToken token) =>
        (Task<object[]>)typeof(Compact24DataMigration).GetMethod(nameof(ReadRows), BindingFlags.NonPublic | BindingFlags.Static)!
            .MakeGenericMethod(type).Invoke(null, [db, token])!;

    private static async Task<object[]> ReadRows<T>(DbContext db, CancellationToken token) where T : class =>
        (await db.Set<T>().AsNoTracking().ToArrayAsync(token)).Cast<object>().ToArray();

    private static string[] Fingerprints(IReadOnlyEntityType metadata, object[] rows)
    {
        // Values (especially hashes and identity envelopes) never leave this process or enter reports.
        return rows.Select(row =>
        {
            var values = new JsonObject();
            foreach (var property in metadata.GetProperties().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
                var value = property.PropertyInfo?.GetValue(row);
                values[property.Name] = property.GetColumnType() == "jsonb" && value is string json
                    ? Canonical(JsonNode.Parse(json)) : JsonSerializer.SerializeToNode(value, property.ClrType);
            }
            return values.ToJsonString();
        }).Order(StringComparer.Ordinal).ToArray();
    }

    private static JsonNode? Canonical(JsonNode? value) => value switch
    {
        JsonObject obj => new JsonObject(obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => KeyValuePair.Create(p.Key, Canonical(p.Value)))),
        JsonArray array => new JsonArray(array.Select(Canonical).ToArray()),
        _ => value?.DeepClone()
    };
}
