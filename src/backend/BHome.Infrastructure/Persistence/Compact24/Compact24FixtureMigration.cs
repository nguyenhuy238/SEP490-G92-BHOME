using System.Data;
using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed record Compact24TableInspection(string Source, string Target, long Rows, bool SupportedByIdentityFixtureCopy);
public sealed record Compact24MigrationInspection(IReadOnlyList<Compact24TableInspection> Tables, IReadOnlyList<string> Blockers);
public sealed record Compact24IdentityCopyResult(int Users, int Sessions, int Tokens, int ResetGrants, int AuditEvents, bool Reconciled);
public sealed class Compact24MigrationException(string code) : InvalidOperationException("Compact fixture migration rejected.")
{ public string Code { get; } = code; }

// Deliberately limited to synthetic/authorized loopback fixture DBs. Not a production cutover tool.
// All 70 tables are inspected; any nonempty unsupported table prevents ALL target writes.
public sealed class Compact24FixtureMigration(BHomeDbContext source, Compact24DbContext target)
{
    private static readonly HashSet<string> IdentitySources = new(StringComparer.Ordinal)
    { "AspNetUsers", "AspNetRoles", "AspNetUserRoles", "AuthenticationSessions", "RefreshTokens", "PasswordResetGrants", "SecurityAudit", "Chains" };

    internal void ValidateConnections()
    {
        var from = new NpgsqlConnectionStringBuilder(source.Database.GetConnectionString());
        var to = new NpgsqlConnectionStringBuilder(target.Database.GetConnectionString());
        static bool Loopback(string? host) => host is "localhost" or "127.0.0.1" or "::1";
        if (!Loopback(from.Host) || !Loopback(to.Host) ||
            !System.Text.RegularExpressions.Regex.IsMatch(from.Database ?? "", "^bhome_compact24_source_[a-f0-9]{32}$") ||
            !System.Text.RegularExpressions.Regex.IsMatch(to.Database ?? "", "^bhome_compact24_[a-f0-9]{32}$"))
            throw new Compact24MigrationException("fixture_database_names_required");
    }

    public async Task<Compact24MigrationInspection> InspectAsync(CancellationToken token = default)
    {
        ValidateConnections();
        await using var tx = await source.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        await source.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", token);
        return await InspectSnapshotAsync(token);
    }

    internal async Task<Compact24MigrationInspection> InspectSnapshotAsync(CancellationToken token, int maximumRowsPerTable = 10000)
    {
        var tables = new List<Compact24TableInspection>(); var blockers = new List<string>();
        var modelTables = source.Model.GetRelationalModel().Tables.Select(t => t.Name).Order().ToArray();
        if (!modelTables.SequenceEqual(Compact24MigrationMap.Tables.Keys.Order())) throw new Compact24MigrationException("source_model_mapping_mismatch");
        var known = source.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
        if ((await source.Database.GetAppliedMigrationsAsync(token)).Any(m => !known.Contains(m) && m != "20261028103339_CaptureWorkflows"))
            blockers.Add("unrecognized_source_migration");
        if ((await source.Database.GetPendingMigrationsAsync(token)).Any()) blockers.Add("source_migrations_pending");
        await source.Database.OpenConnectionAsync(token);
        var connection = (NpgsqlConnection)source.Database.GetDbConnection();
        foreach (var name in modelTables)
        {
            // Identifiers come only from the audited EF model/mapping, never CLI/input.
            await using var count = new NpgsqlCommand($"SELECT count(*) FROM public.\"{name}\"", connection, (NpgsqlTransaction)source.Database.CurrentTransaction!.GetDbTransaction());
            var rows = (long)(await count.ExecuteScalarAsync(token))!;
            var supported = IdentitySources.Contains(name);
            tables.Add(new(name, Compact24MigrationMap.Tables[name], rows, supported));
            if (!supported && rows > 0) blockers.Add("unsupported_source_rows:" + name);
            if (rows > maximumRowsPerTable) blockers.Add("copy_size_limit:" + name);
        }
        await using (var legacy = new NpgsqlCommand("""
            SELECT EXISTS(SELECT 1 FROM "AspNetUsers" u WHERE
              to_jsonb(u)->>'LegacyManagedByOwnerUserId' IS NOT NULL OR to_jsonb(u)->>'ManagingOwnerId' IS NOT NULL)
            """, connection, (NpgsqlTransaction)source.Database.CurrentTransaction!.GetDbTransaction()))
            if ((bool)(await legacy.ExecuteScalarAsync(token))!) blockers.Add("unmapped_legacy_owner_reference");
        return new(tables, blockers);
    }

    public Task<Compact24IdentityCopyResult> CopyIdentityFixtureAsync(CancellationToken token = default) => CopyIdentitySnapshotAsync(false, token);

    internal async Task<Compact24IdentityCopyResult> CopyIdentitySnapshotAsync(bool includeBusiness, CancellationToken token, int maximumRowsPerTable = 10000)
    {
        ValidateConnections();
        await using var read = source.Database.CurrentTransaction is null ? await source.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token) : null;
        await source.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", token);
        var inspection = await InspectSnapshotAsync(token, maximumRowsPerTable);
        if (inspection.Blockers.Any(b => !includeBusiness || !b.StartsWith("unsupported_source_rows:", StringComparison.Ordinal)))
            throw new Compact24MigrationException("source_rows_outside_completed_slices");
        await using var write = target.Database.CurrentTransaction is null ? await target.Database.BeginTransactionAsync(token) : null;
        await target.Database.OpenConnectionAsync(token);
        if (!await target.IsSchemaReadyAsync(token)) throw new Compact24MigrationException("target_schema_mismatch");
        var connection = (NpgsqlConnection)target.Database.GetDbConnection();
        await using (var names = new NpgsqlCommand("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name", connection, (NpgsqlTransaction)target.Database.CurrentTransaction!.GetDbTransaction()))
        {
            var tableNames = new List<string>();
            await using (var reader = await names.ExecuteReaderAsync(token))
                while (await reader.ReadAsync(token)) tableNames.Add(reader.GetString(0));
            await using var schemaStream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
            using var schemaReader = new StreamReader(schemaStream);
            var expectedNames = System.Text.RegularExpressions.Regex.Matches(await schemaReader.ReadToEndAsync(token), @"(?m)^CREATE TABLE ([a-z_]+)")
                .Select(m => m.Groups[1].Value).Order().ToArray();
            if (tableNames.Count != 24 || !tableNames.SequenceEqual(expectedNames)) throw new Compact24MigrationException("target_schema_mismatch");
            foreach (var name in tableNames)
            {
                // Target names are validated against safe identifiers before interpolation.
                if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z_]+$")) throw new Compact24MigrationException("target_identifier_rejected");
                await using var count = new NpgsqlCommand($"SELECT EXISTS(SELECT 1 FROM public.\"{name}\")", connection, (NpgsqlTransaction)target.Database.CurrentTransaction!.GetDbTransaction());
                if ((bool)(await count.ExecuteScalarAsync(token))!) throw new Compact24MigrationException("target_not_empty");
            }
        }
        var users = await source.Users.AsNoTracking().ToArrayAsync(token);
        var roles = await source.Roles.AsNoTracking().ToArrayAsync(token);
        var assignments = await source.UserRoles.AsNoTracking().ToArrayAsync(token);
        var reset = await source.PasswordResetGrants.AsNoTracking().ToArrayAsync(token);
        var sessions = await source.AuthenticationSessions.AsNoTracking().ToArrayAsync(token);
        var refresh = await source.RefreshTokens.AsNoTracking().ToArrayAsync(token);
        var audits = await source.SecurityAudit.AsNoTracking().OrderBy(a => a.OccurredAt).ThenBy(a => a.Id).ToArrayAsync(token);
        var chains = await source.Set<Chain>().AsNoTracking().Take(2).ToArrayAsync(token);
        if (roles.Any(r => r.Name is null || !Roles.All.Contains(r.Name))) throw new Compact24MigrationException("unsupported_source_role");
        var perUser = users.ToDictionary(u => u.Id, u => assignments.Where(a => a.UserId == u.Id)
            .Select(a => roles.Single(r => r.Id == a.RoleId).Name!).Distinct().Order().ToArray());
        if (perUser.Values.Any(r => r.Length == 0)) throw new Compact24MigrationException("source_account_without_role");
        var owners = users.Where(u => perUser[u.Id].Contains(Roles.Owner)).ToArray();
        if (owners.Length != 1 || chains.Length != 1) throw new Compact24MigrationException("source_owner_or_chain_count_requires_decision");
        if (users.Any(u => u.NormalizedUserName is null || u.PasswordHash is null || u.SecurityStamp is null || u.ConcurrencyStamp is null))
            throw new Compact24MigrationException("incomplete_source_identity_state");
        if (users.GroupBy(u => u.NormalizedEmail).Any(g => g.Key is not null && g.Count() > 1)) throw new Compact24MigrationException("ambiguous_normalized_email");
        foreach (var user in users)
        {
            target.Users.Add(user);
            target.Entry(user).Property("roles").CurrentValue = perUser[user.Id];
            var grant = reset.SingleOrDefault(g => g.UserId == user.Id);
            if (grant is not null)
            {
                target.Entry(user).Property("reset_token_hash").CurrentValue = grant.TokenHash;
                target.Entry(user).Property("reset_expires_at").CurrentValue = grant.ExpiresAt;
                target.Entry(user).Property("reset_consumed_at").CurrentValue = grant.ConsumedAt;
            }
            if (user.Id == owners[0].Id)
                target.Entry(user).Property("business_profile").CurrentValue = JsonSerializer.Serialize(new { schemaVersion = 1, chain = chains[0], identityRoles = roles }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        foreach (var s in sessions)
            target.Refresh.Add(new CompactRefreshRow
            {
                Id = s.Id,
                UserId = s.UserId,
                RecordKind = "SESSION",
                SecurityStamp = s.SecurityStamp,
                DeviceLabel = s.Device,
                IssuedAt = s.CreatedAt,
                LastActivityAt = s.LastActivityAt,
                ExpiresAt = s.ExpiresAt,
                RevokedAt = s.RevokedAt,
                RevocationReason = s.RevocationReason
            });
        await target.SaveChangesAsync(token);
        foreach (var r in refresh)
            target.Refresh.Add(new CompactRefreshRow
            {
                Id = r.Id,
                UserId = sessions.Single(s => s.Id == r.SessionId).UserId,
                RecordKind = "TOKEN",
                SessionId = r.SessionId,
                TokenHash = r.TokenHash,
                IssuedAt = r.CreatedAt,
                ExpiresAt = r.ExpiresAt,
                ConsumedAt = r.ConsumedAt,
                ReplacedByTokenId = r.ReplacedByTokenId
            });
        await target.SaveChangesAsync(token);
        foreach (var a in audits)
        {
            // Retain original actor/target/session even when the old independent audit references a removed user.
            var json = JsonSerializer.Serialize(new { schemaVersion = 1, source = "SecurityAudit", recordType = "SecurityAuditRecord", state = a, originalActorId = a.UserId, a.TargetUserId, a.SessionId, a.TargetType, a.TargetId, a.Succeeded }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var actor = users.Any(u => u.Id == a.UserId) ? a.UserId : null;
            await target.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at)
                VALUES ({a.Id},'AUDIT',{actor},{"legacy:securityaudit:" + a.Id.ToString("N")},{a.Event},{a.TargetType ?? "User"},{a.TargetId ?? a.TargetUserId},CAST({json} AS jsonb),{a.OccurredAt})
                """, token);
        }
        target.ChangeTracker.Clear();
        var copied = await target.Users.AsNoTracking().ToArrayAsync(token);
        var copiedSessions = await target.Refresh.AsNoTracking().ToArrayAsync(token);
        if (users.Length != copied.Length || users.Any(u => JsonSerializer.Serialize(copied.Single(c => c.Id == u.Id)) != JsonSerializer.Serialize(u)) ||
            sessions.Length + refresh.Length != copiedSessions.Length)
            throw new InvalidOperationException("Identity reconciliation failed; target transaction rolled back.");
        foreach (var user in users)
        {
            var row = await target.Users.Where(u => u.Id == user.Id).Select(u => new
            {
                Roles = EF.Property<string[]>(u, "roles"),
                ResetHash = EF.Property<string>(u, "reset_token_hash"),
                ResetExpires = EF.Property<DateTimeOffset?>(u, "reset_expires_at"),
                ResetConsumed = EF.Property<DateTimeOffset?>(u, "reset_consumed_at")
            }).SingleAsync(token);
            var grant = reset.SingleOrDefault(g => g.UserId == user.Id);
            if (!row.Roles.ToHashSet().SetEquals(perUser[user.Id]) || row.ResetHash != grant?.TokenHash || row.ResetExpires != grant?.ExpiresAt || row.ResetConsumed != grant?.ConsumedAt)
                throw new InvalidOperationException("Role/reset reconciliation failed; target transaction rolled back.");
        }
        foreach (var s in sessions)
        {
            var row = copiedSessions.Single(c => c.Id == s.Id);
            if (row.RecordKind != "SESSION" || row.UserId != s.UserId || row.SecurityStamp != s.SecurityStamp || row.DeviceLabel != s.Device || row.IssuedAt != s.CreatedAt ||
                row.LastActivityAt != s.LastActivityAt || row.ExpiresAt != s.ExpiresAt || row.RevokedAt != s.RevokedAt || row.RevocationReason != s.RevocationReason)
                throw new InvalidOperationException("Session reconciliation failed; target transaction rolled back.");
        }
        foreach (var r in refresh)
        {
            var row = copiedSessions.Single(c => c.Id == r.Id);
            if (row.RecordKind != "TOKEN" || row.SessionId != r.SessionId || row.IssuedAt != r.CreatedAt || row.TokenHash != r.TokenHash || row.ConsumedAt != r.ConsumedAt || row.ExpiresAt != r.ExpiresAt || row.ReplacedByTokenId != r.ReplacedByTokenId)
                throw new InvalidOperationException("Token reconciliation failed; target transaction rolled back.");
        }
        await using (var query = new NpgsqlCommand("SELECT id,event_at FROM notifications WHERE record_kind='AUDIT'", connection, (NpgsqlTransaction)target.Database.CurrentTransaction!.GetDbTransaction()))
        {
            var copiedAudit = new Dictionary<Guid, DateTimeOffset>();
            await using var reader = await query.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) copiedAudit.Add(reader.GetGuid(0), reader.GetFieldValue<DateTimeOffset>(1));
            if (copiedAudit.Count != audits.Length || audits.Any(a => !copiedAudit.TryGetValue(a.Id, out var at) || at != a.OccurredAt))
                throw new InvalidOperationException("Audit reconciliation failed; target transaction rolled back.");
        }
        if (write is not null) await write.CommitAsync(token);
        return new(users.Length, sessions.Length, refresh.Length, reset.Length, audits.Length, true);
    }
}
