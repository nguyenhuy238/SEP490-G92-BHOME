using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Domain.Common;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24DbContext
{
    private static readonly JsonSerializerOptions RecordJson = new(JsonSerializerDefaults.Web);
    internal bool Importing { get; set; }
    public override void PrepareUserRole(ApplicationUser user, string role)
    {
        if (Entry(user).State is not (EntityState.Detached or EntityState.Added) || !BHome.Domain.IdentityAccess.Roles.All.Contains(role))
            throw new InvalidOperationException("Prepare a supported role only for a new account.");
        Entry(user).Property<string[]>("roles").CurrentValue = [role];
    }

    internal override async Task<IReadOnlyList<BHome.Application.Billing.BillingQueueView>> BillingQueueAsync(Guid location, DateOnly period, CancellationToken token)
    {
        var key = period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        return await Database.SqlQuery<BHome.Application.Billing.BillingQueueView>($"""
            SELECT j.id AS "Id",j.task_data->>'name' AS "Name",j.status AS "State",j.attempt_count AS "Attempts",
              j.next_run_at AS "AvailableAt",j.locked_until AS "LockedUntil",j.task_data->>'lastErrorCode' AS "LastErrorCode"
            FROM operational_tasks j JOIN locations l ON l.id={location}
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.operating_settings->'automationPlanVersions','[]'::jsonb)) p
            WHERE j.task_type='SYSTEM_JOB' AND j.task_data->'payload'->>'PlanId'=p->>'id'
              AND j.task_data->'payload'->>'BillingPeriod'={key}
              AND j.task_data->>'name' IN ('billing-meter','billing-draft','billing-final')
            ORDER BY j.next_run_at DESC LIMIT 30
            """).ToArrayAsync(token);
    }

    public override IQueryable<T> Locked<T>(Guid id, bool skipLocked = false, bool shared = false)
    {
        var suffix = shared ? " FOR SHARE" : " FOR UPDATE" + (skipLocked ? " SKIP LOCKED" : "");
        if (typeof(T) == typeof(ApplicationUser))
            return Set<T>().FromSqlRaw("SELECT * FROM users WHERE id={0}" + suffix, id);
        var spec = Compact24Records.For(typeof(T));
        var predicate = spec.Kind is CompactRecordKind.Array or CompactRecordKind.History
            ? $"EXISTS(SELECT 1 FROM jsonb_array_elements({spec.Container}{(spec.Path is null ? "" : "->'" + spec.Path + "'")}) e WHERE COALESCE(e->>'id',e->'state'->>'id')={{0}}::text)"
            : "id={0}";
        var sql = spec.Select(Model.FindEntityType(typeof(T))!).Replace(spec.Table + " t",
            $"(SELECT * FROM {spec.Table} WHERE {predicate}{suffix}) t", StringComparison.Ordinal);
        sql = sql.Replace("{", "{{", StringComparison.Ordinal).Replace("}", "}}", StringComparison.Ordinal)
            .Replace("{{0}}", "{0}", StringComparison.Ordinal);
        return Set<T>().FromSqlRaw(sql, id).Where(x => EF.Property<Guid>(x, "Id") == id);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ChangeTracker.DetectChanges();
        var domain = ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted &&
            e.Entity is not ApplicationUser && e.Entity is not CompactRefreshRow).ToArray();
        if (domain.Length == 0) return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        var snapshots = domain.Select(e => (Entry: e, State: e.State, Original: e.OriginalValues.Clone())).ToArray();
        void RestorePendingState()
        {
            foreach (var snapshot in snapshots)
            {
                snapshot.Entry.OriginalValues.SetValues(snapshot.Original);
                snapshot.Entry.State = snapshot.State;
            }
        }
        var at = DateTimeOffset.UtcNow;
        foreach (var entry in domain)
        {
            var spec = Compact24Records.For(entry.Metadata.ClrType);
            if (spec.AppendOnly && entry.State != EntityState.Added)
                throw new InvalidOperationException(spec.Name + " is append-only.");
            if (!Importing && entry.Entity is AuditableEntity auditable && entry.State != EntityState.Deleted)
                auditable.Stamp(at, entry.State == EntityState.Added);
        }
        ChangeTracker.DetectChanges();
        await using var own = Database.CurrentTransaction is null ? await Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            var propertyLocations = await LockPropertyConfigurationAsync(domain, cancellationToken);
            // Inserts follow the same parent-first dependencies as EF. JSON children additionally
            // depend on their containing row; no independently committed business write is allowed.
            foreach (var entry in OrderWrites(domain)) await WriteDomainAsync(entry, cancellationToken);
            await ValidatePropertyConfigurationAsync(propertyLocations, cancellationToken);
            // EF must never attempt to update a projection's former table name.
            foreach (var entry in domain)
            {
                if (entry.State == EntityState.Deleted) entry.State = EntityState.Detached;
                else
                {
                    // Setting Modified -> Unchanged otherwise rejects current values in EF.
                    // Accept the successfully persisted snapshot before suppressing EF DML.
                    entry.OriginalValues.SetValues(entry.CurrentValues);
                    entry.State = EntityState.Unchanged;
                }
            }
            var count = domain.Length + await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
            if (own is not null) await own.CommitAsync(cancellationToken);
            if (!acceptAllChangesOnSuccess) RestorePendingState();
            return count;
        }
        catch (PostgresException error)
        {
            if (own is not null) await own.RollbackAsync(cancellationToken);
            RestorePendingState();
            throw new DbUpdateException("Compact24 persistence rejected a write.", error);
        }
        catch
        {
            if (own is not null) await own.RollbackAsync(cancellationToken);
            RestorePendingState();
            throw;
        }
    }

    private async Task WriteDomainAsync(EntityEntry entry, CancellationToken token)
    {
        var spec = Compact24Records.For(entry.Metadata.ClrType);
        if (entry.Entity is OperationalTask { Kind: BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading, Purpose: ReadingPurpose.Periodic } periodic)
        {
            // The source database populated these from the meter in a trigger. Preserve that
            // behavior and use source_key's existing unique index for Room/type/period races.
            var meter = await Set<Meter>().AsNoTracking().Where(m => m.Id == periodic.MeterId)
                .Select(m => new { m.RoomId, m.UtilityType }).SingleAsync(token);
            periodic.BillingRoomId = meter.RoomId; periodic.BillingUtilityType = meter.UtilityType;
        }
        var state = JsonSerializer.Serialize(entry.Properties.ToDictionary(p => CompactRecordSql.Camel(p.Metadata.Name), p => p.CurrentValue), RecordJson);
        var key = string.Join("/", entry.Metadata.FindPrimaryKey()!.Properties.Select(p => Convert.ToString(entry.Property(p.Name).CurrentValue, System.Globalization.CultureInfo.InvariantCulture)));
        var envelope = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = spec.Name,
            recordKey = key,
            deleted = entry.State == EntityState.Deleted,
            state = JsonNode.Parse(state)
        }, RecordJson);
        await AssignSequenceAsync(entry, token);
        // Sequence is assigned under the parent lock and becomes part of the persisted snapshot.
        if (entry.Metadata.FindProperty("Sequence") is not null)
        {
            state = JsonSerializer.Serialize(entry.Properties.ToDictionary(p => CompactRecordSql.Camel(p.Metadata.Name), p => p.CurrentValue), RecordJson);
            envelope = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = spec.Name, recordKey = key, deleted = false, state = JsonNode.Parse(state) }, RecordJson);
        }
        if (entry.Entity is DepositVerification deposit) { await WriteDepositAsync(deposit, state, envelope, token); return; }
        if (!Importing && entry.Entity is PaymentAllocation allocation) await ValidateAllocationAsync(allocation, token);
        if (entry.Entity is BankReferenceClaim claim) { await WriteImportedClaimAsync(claim, envelope, token); return; }
        if (entry.Entity is InvoiceRecipient) { await WriteRecipientAsync(entry, token); return; }
        if (spec.Kind == CompactRecordKind.Computed) throw new InvalidOperationException("Computed Compact24 record cannot be written.");
        if (spec.Kind == CompactRecordKind.Notification) { await WriteNotificationAsync(entry, spec, state, envelope, key, token); return; }
        if (spec.Kind == CompactRecordKind.Technical) { await WriteTechnicalAsync(entry, spec, state, key, envelope, token); return; }
        if (spec.Kind is CompactRecordKind.Array or CompactRecordKind.Object or CompactRecordKind.History)
        { await WriteEmbeddedAsync(entry, spec, state, envelope, key, token); return; }
        if (entry.State == EntityState.Deleted)
        {
            // Draft invoice lines are a replaceable calculation. Final lines are protected by SQL.
            if (entry.Entity is not InvoiceLine) throw new InvalidOperationException("Business record retention requires an explicit transition.");
            await CommandAsync("DELETE FROM invoice_items WHERE id=(@state::jsonb->>'id')::uuid", state, envelope, key, token);
            return;
        }
        var values = new Dictionary<string, string>(spec.Write, StringComparer.Ordinal);
        if (entry.Entity is BHome.Domain.Locations.Location)
            values["operating_settings"] = "COALESCE((SELECT operating_settings FROM locations WHERE id=(@state::jsonb->>'id')::uuid),'{}'::jsonb)||jsonb_build_object('contractSettings',(@state::jsonb->>'contractSettings')::jsonb)";
        if (entry.Entity is Invoice invoice)
        {
            var ids = invoice.Recipients.Select(r => r.TenantUserId).Distinct().ToArray();
            if (ids.Length == 0) throw new InvalidOperationException("Invoice recipient snapshot is required.");
            values["recipient_user_ids"] = "@recipients::jsonb";
            if (Importing) values["status"] = "0";
        }
        var hasHistory = spec.Table is not ("invoice_items" or "payment_allocations");
        if (hasHistory) values["history"] = "COALESCE((SELECT history FROM " + spec.Table + " WHERE " + RootKey(spec) + "),'[]'::jsonb)||jsonb_build_array(@envelope::jsonb)";
        var columns = values.Keys.ToArray();
        var json = "jsonb_build_object(" + string.Join(",", values.Select(p => "'" + p.Key + "'," + p.Value)) + ")";
        var sql = entry.State == EntityState.Added
            ? $"INSERT INTO {spec.Table}({string.Join(',', columns)}) SELECT {string.Join(',', columns.Select(c => "r." + c))} FROM jsonb_populate_record(NULL::{spec.Table},{json}) r"
            : $"UPDATE {spec.Table} t SET ({string.Join(',', columns)})=(SELECT {string.Join(',', columns.Select(c => "r." + c))} FROM jsonb_populate_record(NULL::{spec.Table},{json}) r) WHERE {RootKey(spec, "t.")}";
        if (entry.State == EntityState.Modified && VersionProperty(entry) is { } version)
            sql += " AND t.version=@version";
        var affected = await CommandAsync(sql, state, envelope, key, token, entry);
        if (affected != 1) throw new DbUpdateConcurrencyException("Compact24 record changed or no longer exists.");
        if (entry.Entity is PaymentAllocation paid)
        {
            await ExecuteAsync("UPDATE payments SET history=history||jsonb_build_array(@envelope::jsonb) WHERE id=@id", token,
                ("id", paid.TransferId), ("envelope", envelope));
            if (!Importing)
                await ClaimReferenceAsync(paid.TransferId, paid.Id, null, token);
        }
    }

    private static string RootKey(CompactRecordSql spec, string prefix = "") => spec.Name == "ContractResident"
        ? $"{prefix}contract_id=(@state::jsonb->>'contractId')::uuid AND {prefix}resident_id=(@state::jsonb->>'residentId')::uuid"
        : $"{prefix}id=(@state::jsonb->>'id')::uuid";

    private static string? VersionProperty(EntityEntry entry) => entry.Metadata.FindProperty("Version")?.IsConcurrencyToken == true
        ? "Version" : entry.Metadata.FindProperty("DraftVersion")?.IsConcurrencyToken == true ? "DraftVersion" : null;

    private async Task<int> CommandAsync(string sql, string state, string envelope, string key, CancellationToken token, EntityEntry? entry = null)
    {
        await Database.OpenConnectionAsync(token);
        await using var cmd = new NpgsqlCommand(sql, (NpgsqlConnection)Database.GetDbConnection(),
            (NpgsqlTransaction?)Database.CurrentTransaction?.GetDbTransaction());
        cmd.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, state);
        cmd.Parameters.AddWithValue("envelope", NpgsqlDbType.Jsonb, envelope);
        cmd.Parameters.AddWithValue("key", key);
        if (entry?.Entity is Invoice invoice)
            cmd.Parameters.AddWithValue("recipients", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(invoice.Recipients.Select(r => r.TenantUserId).Distinct()));
        if (entry is not null && VersionProperty(entry) is { } v)
            cmd.Parameters.AddWithValue("version", entry.Property(v).OriginalValue!);
        return await cmd.ExecuteNonQueryAsync(token);
    }

    private async Task WriteEmbeddedAsync(EntityEntry entry, CompactRecordSql spec, string state, string envelope, string key, CancellationToken token)
    {
        var parent = entry.Property(spec.Parent).CurrentValue;
        string where;
        if (spec.Name == "Chain") where = "'Owner'=ANY(roles)";
        else where = "id=(@state::jsonb->>'" + CompactRecordSql.Camel(spec.Parent) + "')::uuid";
        var column = spec.Container;
        var source = "COALESCE(" + column + (spec.Path is null ? "" : "->'" + spec.Path + "'") + "," + (spec.Kind == CompactRecordKind.Object ? "'{}'" : "'[]'") + "::jsonb)";
        var updated = spec.Kind switch
        {
            CompactRecordKind.Object => "@state::jsonb",
            CompactRecordKind.History => source + "||jsonb_build_array(@envelope::jsonb)",
            _ => "COALESCE((SELECT jsonb_agg(e ORDER BY n) FROM jsonb_array_elements(" + source + ") WITH ORDINALITY a(e,n) WHERE e->>'id' IS DISTINCT FROM @state::jsonb->>'id'),'[]'::jsonb)" +
                (entry.State == EntityState.Deleted ? "" : "||jsonb_build_array(@state::jsonb||jsonb_build_object('recordType','" + spec.Name + "'))")
        };
        if (spec.Kind == CompactRecordKind.Object && entry.State == EntityState.Deleted) updated = "'{}'::jsonb";
        if (spec.Path is not null) updated = "jsonb_set(" + column + ",'{" + spec.Path + "}'," + updated + ",true)";
        var assignments = column + "=" + updated;
        if (spec.Name == "InvoiceAdjustmentDecision")
            assignments += ",status=CASE WHEN @state::jsonb->>'outcome'='Approved' THEN 'APPROVED' ELSE 'REJECTED' END,approved_delta_amount=(@state::jsonb->>'delta')::numeric,decided_by_user_id=(@state::jsonb->>'ownerId')::uuid,decided_at=(@state::jsonb->>'decidedAt')::timestamptz,decision_reason=@state::jsonb->>'reason'";
        if (column != "history" && spec.Table is not ("users" or "notifications"))
            assignments += ",history=history||jsonb_build_array(@envelope::jsonb)";
        var count = await CommandAsync($"UPDATE {spec.Table} SET {assignments} WHERE {where}", state, envelope, key, token, entry);
        if (count != 1) throw new DbUpdateConcurrencyException("Compact24 containing record is unavailable.");
        if (entry.Entity is BHome.Domain.IncidentMaintenance.EmergencyAction emergency)
            await ExecuteAsync("UPDATE incident_reports SET emergency_actions=emergency_actions||jsonb_build_array(@envelope::jsonb) WHERE id=@id", token,
                ("id", emergency.IncidentId), ("envelope", envelope));
        if (entry.Entity is BHome.Domain.IncidentMaintenance.IncidentEvidence evidence)
        {
            // Report photos have their own five-image limit. Inspection/completion
            // evidence belongs to the Work Order and must not consume that limit.
            var table = evidence.WorkOrderId.HasValue ? "operational_tasks" : "incident_reports";
            if (evidence.WorkOrderId.HasValue || evidence.Kind == BHome.Domain.IncidentMaintenance.IncidentEvidenceKind.Report)
                await ExecuteAsync($"UPDATE {table} SET evidence=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence) e WHERE e->>'id'<>@key),'[]'::jsonb)||jsonb_build_array(@state::jsonb||jsonb_build_object('recordType','IncidentEvidence')) WHERE id=@id", token,
                    ("id", evidence.WorkOrderId ?? evidence.IncidentId), ("key", evidence.Id.ToString()), ("state", state));
        }
    }

    private async Task WriteTechnicalAsync(EntityEntry entry, CompactRecordSql spec, string state, string key, string envelope, CancellationToken token)
    {
        var id = DeterministicId(spec.Name + "/" + key);
        var sourceKey = spec.Name + ":" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key)));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = spec.Name, deleted = entry.State == EntityState.Deleted, state = JsonNode.Parse(state) }, RecordJson);
        if (entry.Entity is BHome.Infrastructure.Jobs.BackgroundJobRecord job)
        {
            id = job.Id;
            sourceKey = "job:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new[] { job.Name, job.IdempotencyKey }))));
            data = JsonSerializer.Serialize(new { schemaVersion = 1, name = job.Name, idempotencyKey = job.IdempotencyKey, payload = JsonNode.Parse(job.PayloadJson), lastErrorCode = job.LastErrorCode });
        }
        else if (entry.Metadata.FindProperty("Id") is not null) id = (Guid)entry.Property("Id").CurrentValue!;
        await ExecuteAsync("""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES(@id,@kind,@source,'Pending',@data::jsonb,jsonb_build_array(@envelope::jsonb))
            ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
            """, token, ("id", id), ("kind", spec.Name.EndsWith("Command", StringComparison.Ordinal) || spec.Name == "ContractOperation" ? "COMMAND" : "SYSTEM_JOB"),
            ("source", sourceKey), ("data", data), ("envelope", envelope));
        if (entry.Entity is BHome.Infrastructure.Jobs.BackgroundJobRecord j)
            await ExecuteAsync("UPDATE operational_tasks SET status=@status,next_run_at=@available,attempt_count=@attempts,locked_until=@locked,lease_token=@lease WHERE id=@id", token,
                ("id", id), ("status", j.State), ("available", j.AvailableAt), ("attempts", j.Attempts), ("locked", j.LockedUntil), ("lease", j.LockToken));
    }

    private async Task WriteRecipientAsync(EntityEntry entry, CancellationToken token)
    {
        if (entry.State == EntityState.Deleted) throw new InvalidOperationException("Historical invoice recipients cannot be removed.");
        var invoice = (Guid)entry.Property("InvoiceId").CurrentValue!;
        var user = (Guid)entry.Property("TenantUserId").CurrentValue!;
        await ExecuteAsync("UPDATE invoices SET recipient_user_ids=array_append(recipient_user_ids,@user) WHERE id=@invoice AND NOT @user=ANY(recipient_user_ids)", token, ("invoice", invoice), ("user", user));
    }

    internal static Guid DeterministicId(string key) => new(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key)).AsSpan(0, 16));

    private async Task<int> ExecuteAsync(string sql, CancellationToken token, params (string Name, object? Value)[] parameters)
    {
        await Database.OpenConnectionAsync(token);
        await using var cmd = new NpgsqlCommand(sql, (NpgsqlConnection)Database.GetDbConnection(), (NpgsqlTransaction?)Database.CurrentTransaction?.GetDbTransaction());
        foreach (var (name, value) in parameters)
        {
            if (value is null) cmd.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Unknown) { Value = DBNull.Value });
            else cmd.Parameters.AddWithValue(name, value);
        }
        return await cmd.ExecuteNonQueryAsync(token);
    }
}
