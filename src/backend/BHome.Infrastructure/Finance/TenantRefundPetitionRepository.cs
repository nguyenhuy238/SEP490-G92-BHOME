using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

internal sealed class TenantRefundPetitionRepository(BHomePersistenceContext db) : ITenantRefundPetitionRepository
{
    private const string Kind = "TenantRefundPetitionV1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private IQueryable<TenantRefundPetitionRecord> Rows => db.Database.SqlQuery<TenantRefundPetitionRecord>($"""
        SELECT r.id AS "Id",r.beneficiary_resident_id AS "BeneficiaryResidentId",
          r.requested_by_user_id AS "TenantUserId", COALESCE(u.full_name,u.username) AS "TenantLabel",
          r.requested_amount AS "Amount",r.reason AS "Reason",r.status AS "Status",
          r.requested_at AS "CreatedAt",r.operation_key AS "OperationKey",r.version AS "Version",
          r.decided_by_user_id AS "DecidedBy",r.decided_at AS "DecidedAt",
          r.decision_reason AS "DecisionReason",r.executed_at AS "ExecutedAt",
          r.external_refund_reference AS "ExternalReference",r.execution_evidence_key AS "EvidenceKey",
          r.history::text AS "HistoryJson"
        FROM refund_requests r
          JOIN residents person ON person.id=r.beneficiary_resident_id
          JOIN users u ON u.id=r.requested_by_user_id
        WHERE r.source_payment_id IS NULL AND r.source_deposit_contract_id IS NULL
          AND r.beneficiary_kind='RESIDENT'
          AND r.history @> jsonb_build_array(jsonb_build_object('recordType','TenantRefundPetitionV1'))
        """);

    private static TenantRefundPetitionRecord Decode(TenantRefundPetitionRecord row)
    {
        using var history = JsonDocument.Parse(row.HistoryJson);
        var latest = history.RootElement.EnumerateArray().Last(e =>
            e.TryGetProperty("recordType", out var kind) && kind.GetString() == Kind);
        row.State = latest.GetProperty("state").Deserialize<TenantRefundPetitionState>(Json)
            ?? throw new FinanceException(409, "refund_history_invalid");
        if (row.State.Classification != Kind || row.TenantUserId == Guid.Empty ||
            row.BeneficiaryResidentId == Guid.Empty)
            throw new FinanceException(409, "refund_history_invalid");
        return row;
    }
    public async Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", token);
        var result = await work();
        await tx.CommitAsync(token);
        return result;
    }
    public async Task<PagedResult<TenantRefundPetitionRecord>> ListAsync(Guid? tenantId, int page, int size,
        CancellationToken token)
    {
        var query = Rows.Where(r => tenantId == null || r.TenantUserId == tenantId);
        var count = await query.CountAsync(token);
        var rows = await query.OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * size).Take(size).ToArrayAsync(token);
        return new(rows.Select(Decode).ToArray(), page, size, count);
    }
    public async Task<TenantRefundPetitionRecord> GetAsync(Guid id, CancellationToken token) =>
        Decode(await Rows.SingleOrDefaultAsync(r => r.Id == id, token)
            ?? throw new FinanceException(404, "refund_not_found"));
    public async Task<TenantRefundPetitionRecord?> ByOperationAsync(Guid key, CancellationToken token)
    {
        if (await Rows.SingleOrDefaultAsync(r => r.OperationKey == key, token) is { } row)
            return Decode(row);
        if (await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM refund_requests WHERE operation_key={key}) AS "Value"
            """).SingleAsync(token))
            throw new FinanceException(409, "refund_idempotency_conflict");
        return null;
    }
    public Task<Guid?> ResidentIdAsync(Guid tenantId, CancellationToken token) =>
        db.Database.SqlQuery<Guid?>($"""
            SELECT id AS "Value" FROM residents WHERE user_id={tenantId} ORDER BY id LIMIT 1
            """).FirstOrDefaultAsync(token);
    public async Task<TenantRefundPetitionSources> SourcesAsync(Guid tenantId, CancellationToken token)
    {
        var payments = await db.Database.SqlQuery<TenantRefundSourceChoice>($"""
            SELECT DISTINCT p.id AS "Id",
              ('Giao dịch ' || left(p.transaction_reference,32)) AS "Label"
            FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
            WHERE a.paid_by_user_id={tenantId} AND p.status='VERIFIED'
            """).OrderBy(p => p.Label).Take(100).ToArrayAsync(token);
        var contracts = await db.Database.SqlQuery<TenantRefundSourceChoice>($"""
            SELECT DISTINCT c.id AS "Id",
              ('Hợp đồng phòng ' || rm.room_number || ' (' || c.contract_type || ')') AS "Label"
            FROM contracts c JOIN rooms rm ON rm.id=c.room_id
              LEFT JOIN contract_residents cr ON cr.contract_id=c.id
              LEFT JOIN residents resident ON resident.id=cr.resident_id
            WHERE (resident.user_id={tenantId} OR c.tenant_user_id={tenantId})
            """).OrderBy(c => c.Label).Take(100).ToArrayAsync(token);
        return new(payments, contracts);
    }
    public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken token) =>
        db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM refund_requests r WHERE r.id<>{exceptId}
              AND (upper(r.external_refund_reference)={reference} OR EXISTS(
                SELECT 1 FROM jsonb_array_elements(r.history) e
                WHERE e->'state'->'upload'->>'externalReference'={reference}))) AS "Value"
            """).SingleAsync(token);
    public async Task SaveAsync(TenantRefundPetitionRecord row, bool create, Guid actor, string action,
        DateTimeOffset now, CancellationToken token)
    {
        var entries = JsonNode.Parse(row.HistoryJson) as JsonArray
            ?? throw new FinanceException(409, "refund_history_invalid");
        entries.Add(new JsonObject
        {
            ["recordType"] = Kind,
            ["state"] = JsonSerializer.SerializeToNode(row.State, Json)
        });
        var history = entries.ToJsonString();
        if (create)
        {
            // Compact24 does not silently upgrade a populated Development database.
            // Return a clear operational conflict instead of an opaque SQL CHECK failure
            // when the reviewed tenant-petition migration has not been applied yet.
            var ready = await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.refund_requests'::regclass
                    AND conname='ck_refund_source_or_tenant_petition') AS "Value"
                """).SingleAsync(token);
            if (!ready) throw new FinanceException(409, "tenant_refund_schema_upgrade_required");
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,source_deposit_contract_id,
                  beneficiary_resident_id,beneficiary_kind,requested_by_user_id,requested_at,
                  requested_amount,reason,status,operation_key,version,history)
                VALUES({row.Id},NULL,NULL,{row.BeneficiaryResidentId},'RESIDENT',{actor},
                  {row.CreatedAt},{row.Amount},{row.Reason},{row.Status},{row.OperationKey},{row.Version},
                  {history}::jsonb)
                """, token);
        }
        else
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE refund_requests SET status={row.Status},version={row.Version},
                  decided_by_user_id={row.DecidedBy},decided_at={row.DecidedAt},
                  decision_reason={row.DecisionReason},executed_at={row.ExecutedAt},
                  external_refund_reference={row.ExternalReference},
                  execution_evidence_key={row.EvidenceKey},history={history}::jsonb
                WHERE id={row.Id}
                """, token);
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = actor,
            TargetId = row.Id,
            TargetType = "Refund",
            Event = action,
            Succeeded = true,
            OccurredAt = now
        });
        await db.SaveChangesAsync(token);
    }
}
