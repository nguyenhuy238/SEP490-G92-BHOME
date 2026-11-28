using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

// Native request/decision snapshots and durable upload/command records. The
// ledger lock remains owned by AdjustmentRepository; no independent commit.
internal static class NativeAdjustmentPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record RequestState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid InvoiceId, Guid RequesterId, Guid? InvoiceLineId, string? ChargeCode, decimal CurrentAmount,
        decimal? ProposedAmount, string Reason, string InvoiceSnapshot, InvoiceStatus InvoiceStatus,
        int InvoiceVersion, int FinancialVersion, DateTimeOffset SubmittedAt);
    private sealed record DecisionState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        long Sequence, Guid RequestId, Guid InvoiceId, string Outcome, InvoiceStatus InvoiceStatus,
        string? ChargeCode, decimal BeforeAmount, decimal? CorrectedAmount, decimal Delta,
        decimal EffectiveBefore, decimal EffectiveAfter, decimal PaidAtDecision, string SourceFingerprint,
        string Reason, Guid OwnerId, DateTimeOffset DecidedAt);

    internal static IQueryable<Native.InvoiceAdjustment> Visible(Compact24DbContext db, InvoiceScope scope)
    {
        var invoices = NativeInvoicePersistence.Visible(db, scope);
        return db.Set<Native.InvoiceAdjustment>().AsNoTracking().Where(r => invoices.Any(i => i.Id == r.InvoiceId)
            && (scope.Owner || scope.Tenant && r.RequestedByUserId == scope.Actor));
    }

    internal static async Task<InvoiceAdjustmentRequest[]> ReadAsync(Compact24DbContext db,
        IQueryable<Native.InvoiceAdjustment> query, CancellationToken t)
    {
        var rows = await query.ToArrayAsync(t);
        if (rows.Length == 0) return [];
        var ids = rows.Select(r => r.Id).ToArray();
        var invoiceIds = rows.Select(r => r.InvoiceId).Distinct().ToArray();
        var invoices = (await NativeInvoicePersistence.ReadAsync(db, db.Set<Native.Invoice>().AsNoTracking()
            .Where(i => invoiceIds.Contains(i.Id)), t, includeLines: false)).ToDictionary(i => i.Id);
        var evidence = (await db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB'
                AND task_data->>'recordType'='InvoiceAdjustmentEvidence'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND (task_data->'state'->>'requestId')::uuid=ANY({ids})
            """).AsNoTracking().ToArrayAsync(t)).Select(ReadEvidence).ToLookup(e => e.RequestId);
        return rows.Select(row =>
        {
            var state = row.RequestSnapshot.GetProperty("compactState").Deserialize<RequestState>(Json)
                ?? throw new InvalidOperationException("Missing invoice adjustment request snapshot.");
            var request = InvoiceAdjustmentRequest.RestoreIdentity(row.Id, state.CreatedAt, state.UpdatedAt);
            request.InvoiceId = row.InvoiceId;
            request.Invoice = invoices[row.InvoiceId];
            request.RequesterId = row.RequestedByUserId;
            request.SubmittedAt = row.RequestedAt;
            request.Reason = row.Reason;
            request.InvoiceLineId = state.InvoiceLineId;
            request.ChargeCode = state.ChargeCode;
            request.CurrentAmount = state.CurrentAmount;
            request.ProposedAmount = state.ProposedAmount;
            request.InvoiceSnapshot = state.InvoiceSnapshot;
            request.InvoiceStatus = state.InvoiceStatus;
            request.InvoiceVersion = state.InvoiceVersion;
            request.FinancialVersion = state.FinancialVersion;
            request.Decision = ReadDecision(row);
            request.Evidence = evidence[row.Id].ToList();
            return request;
        }).ToArray();
    }

    internal static InvoiceAdjustmentDecision? ReadDecision(Native.InvoiceAdjustment row)
    {
        if (row.DecisionSnapshot is not { } snapshot) return null;
        var state = snapshot.Deserialize<DecisionState>(Json)
            ?? throw new InvalidOperationException("Missing invoice adjustment decision snapshot.");
        var decision = InvoiceAdjustmentDecision.RestoreIdentity(state.Id, state.CreatedAt, state.UpdatedAt);
        decision.Sequence = state.Sequence;
        decision.RequestId = row.Id;
        decision.InvoiceId = row.InvoiceId;
        decision.Outcome = state.Outcome;
        decision.InvoiceStatus = state.InvoiceStatus;
        decision.ChargeCode = state.ChargeCode;
        decision.BeforeAmount = state.BeforeAmount;
        decision.CorrectedAmount = state.CorrectedAmount;
        decision.Delta = state.Delta;
        decision.EffectiveBefore = state.EffectiveBefore;
        decision.EffectiveAfter = state.EffectiveAfter;
        decision.PaidAtDecision = state.PaidAtDecision;
        decision.SourceFingerprint = state.SourceFingerprint;
        decision.Reason = state.Reason;
        decision.OwnerId = state.OwnerId;
        decision.DecidedAt = state.DecidedAt;
        return decision;
    }

    internal static IQueryable<Native.OperationalTask> EvidenceRows(Compact24DbContext db) =>
        db.Set<Native.OperationalTask>().FromSqlRaw("""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB'
                AND task_data->>'recordType'='InvoiceAdjustmentEvidence'
                AND COALESCE(task_data->>'deleted','false')<>'true'
            """).AsNoTracking();

    internal static IQueryable<Native.OperationalTask> ExpiredEvidenceRows(Compact24DbContext db, DateTimeOffset now) =>
        db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB'
                AND task_data->>'recordType'='InvoiceAdjustmentEvidence'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND task_data->'state'->>'requestId' IS NULL
                AND (task_data->'state'->>'cleanupAfter')::timestamptz < {now}
            """).AsNoTracking();

    internal static InvoiceAdjustmentEvidence ReadEvidence(Native.OperationalTask row) =>
        row.TaskData.GetProperty("state").Deserialize<InvoiceAdjustmentEvidence>(Json)
            ?? throw new InvalidOperationException("Missing invoice adjustment evidence snapshot.");

    private static string History<T>(string kind, string key, T state, bool deleted = false) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = key, deleted, state }, Json);

    internal static async Task InsertRequestAsync(Compact24DbContext db, InvoiceAdjustmentRequest r, CancellationToken t)
    {
        RequireTransaction(db);
        r.Stamp(DateTimeOffset.UtcNow, true);
        var state = new RequestState(r.Id, r.CreatedAt, r.UpdatedAt, r.InvoiceId, r.RequesterId,
            r.InvoiceLineId, r.ChargeCode, r.CurrentAmount, r.ProposedAmount, r.Reason, r.InvoiceSnapshot,
            r.InvoiceStatus, r.InvoiceVersion, r.FinancialVersion, r.SubmittedAt);
        var snapshot = JsonSerializer.Serialize(new { schemaVersion = 1, compactState = state }, Json);
        var proposed = JsonSerializer.Serialize(new { r.ChargeCode, r.ProposedAmount }, Json);
        var history = History("InvoiceAdjustmentRequest", r.Id.ToString(), state);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO invoice_adjustments(id,invoice_id,requested_by_user_id,requested_at,reason,
                request_snapshot,proposed_changes,status,history)
            VALUES({r.Id},{r.InvoiceId},{r.RequesterId},{r.SubmittedAt},{r.Reason},
                CAST({snapshot} AS jsonb),CAST({proposed} AS jsonb),'REQUESTED',jsonb_build_array(CAST({history} AS jsonb)))
            """, t);
    }

    internal static async Task InsertDecisionAsync(Compact24DbContext db, InvoiceAdjustmentDecision d, CancellationToken t)
    {
        RequireTransaction(db);
        d.Stamp(DateTimeOffset.UtcNow, true);
        if (d.Sequence == 0)
        {
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('compact24-sequence:InvoiceAdjustmentDecision',0))", t);
            d.Sequence = await db.Database.SqlQueryRaw<long>("""
                SELECT COALESCE(max((h->'state'->>'sequence')::bigint),0)+1 AS "Value"
                FROM invoice_adjustments t CROSS JOIN LATERAL jsonb_array_elements(t.history) h
                WHERE h->>'recordType'='InvoiceAdjustmentDecision'
                """).SingleAsync(t);
        }
        var state = new DecisionState(d.Id, d.CreatedAt, d.UpdatedAt, d.Sequence, d.RequestId, d.InvoiceId,
            d.Outcome, d.InvoiceStatus, d.ChargeCode, d.BeforeAmount, d.CorrectedAmount, d.Delta,
            d.EffectiveBefore, d.EffectiveAfter, d.PaidAtDecision, d.SourceFingerprint, d.Reason, d.OwnerId, d.DecidedAt);
        var snapshot = JsonSerializer.Serialize(state, Json);
        var history = History("InvoiceAdjustmentDecision", d.Id.ToString(), state);
        var status = d.Outcome == "Approved" ? "APPROVED" : "REJECTED";
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE invoice_adjustments SET decision_snapshot=CAST({snapshot} AS jsonb),status={status},
                approved_delta_amount={d.Delta},decided_by_user_id={d.OwnerId},decided_at={d.DecidedAt},
                decision_reason={d.Reason},history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={d.RequestId} AND invoice_id={d.InvoiceId} AND decision_snapshot IS NULL
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Adjustment already decided or unavailable.");
    }

    private static string CommandKey(Guid actor, Guid key, string operation) => $"{actor}/{key}/{operation}";
    internal static async Task<InvoiceAdjustmentCommand?> CommandAsync(Compact24DbContext db, Guid actor,
        Guid key, string operation, CancellationToken t)
    {
        var row = await db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='COMMAND'
                AND task_data->>'recordType'='InvoiceAdjustmentCommand'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND (task_data->'state'->>'actorId')::uuid={actor}
                AND (task_data->'state'->>'key')::uuid={key}
                AND task_data->'state'->>'operation'={operation}
            """).AsNoTracking().SingleOrDefaultAsync(t);
        return row?.TaskData.GetProperty("state").Deserialize<InvoiceAdjustmentCommand>(Json);
    }

    internal static Task<int> InsertCommandAsync(Compact24DbContext db, InvoiceAdjustmentCommand c, CancellationToken t)
    {
        RequireTransaction(db);
        var key = CommandKey(c.ActorId, c.Key, c.Operation);
        const string kind = "InvoiceAdjustmentCommand";
        var id = Compact24DbContext.DeterministicId(kind + "/" + key);
        var source = kind + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, deleted = false, state = c }, Json);
        var history = History(kind, key, c);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({id},'COMMAND',{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            """, t);
    }

    internal static Task<int> SaveEvidenceAsync(Compact24DbContext db, InvoiceAdjustmentEvidence e,
        bool deleted, CancellationToken t)
    {
        RequireTransaction(db);
        const string kind = "InvoiceAdjustmentEvidence";
        var key = e.Id.ToString();
        var source = kind + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, deleted, state = e }, Json);
        var history = History(kind, key, e, deleted);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({e.Id},'SYSTEM_JOB',{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
            WHERE operational_tasks.task_type='SYSTEM_JOB' AND operational_tasks.task_data->>'recordType'='InvoiceAdjustmentEvidence'
            """, t);
    }

    internal static Task<int> WriteEventAsync(Compact24DbContext db, InvoiceAdjustmentEvent e, CancellationToken t)
    {
        RequireTransaction(db);
        var key = $"{e.RequestId}/{e.Name}";
        const string kind = "InvoiceAdjustmentEvent";
        var id = Compact24DbContext.DeterministicId(kind + "/" + key);
        var eventKey = kind + ":" + key;
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, recordType = kind, state = e, audienceRole = (string?)null,
            category = (string?)null, succeeded = (bool?)null, sessionId = (Guid?)null, targetUserId = (Guid?)null
        }, Json);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
            VALUES({id},'OUTBOX',{eventKey},{kind},CAST({data} AS jsonb),{e.OccurredAt})
            """, t);
    }

    internal static Task<int> WriteAuditAsync(Compact24DbContext db, SecurityAuditRecord a, CancellationToken t)
    {
        RequireTransaction(db);
        const string kind = "SecurityAuditRecord";
        var key = kind + ":" + a.Id;
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, recordType = kind, state = a, audienceRole = (string?)null,
            category = (string?)null, succeeded = a.Succeeded, sessionId = a.SessionId, targetUserId = a.TargetUserId
        }, Json);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,
                related_entity_id,event_data,event_at)
            VALUES({a.Id},'AUDIT',{a.UserId},{key},{a.Event},{a.TargetType},{a.TargetId},CAST({data} AS jsonb),{a.OccurredAt})
            """, t);
    }

    private static void RequireTransaction(Compact24DbContext db)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Adjustment persistence requires its existing transaction.");
    }
}
