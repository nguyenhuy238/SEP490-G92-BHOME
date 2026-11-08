using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.Finance;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

internal sealed partial class RefundRepository(BHomePersistenceContext db, BHome.Application.Contracts.IContractSettlementLedger ledger,
    BHome.Application.Contracts.IDepositDeductionEvidence? deductionEvidence = null) : IRefundRepository
{
    private const string Kind = "ExcessReceiptRefundV1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private IQueryable<RefundRecord> Rows => db.Database.SqlQuery<RefundRecord>($"""
        SELECT r.id AS "Id", r.source_payment_id AS "SourcePaymentId", r.source_deposit_contract_id AS "SourceDepositContractId", r.beneficiary_resident_id AS "BeneficiaryResidentId",
          resident.display_label AS "BeneficiaryLabel", r.requested_amount AS "Amount", r.requested_by_user_id AS "RequestedBy",
          r.requested_at AS "RequestedAt", r.reason AS "Reason", r.status AS "Status", r.version AS "Version",
          r.operation_key AS "OperationKey", r.decided_by_user_id AS "DecidedBy", r.decided_at AS "DecidedAt",
          r.decision_reason AS "DecisionReason", r.executed_at AS "ExecutedAt", r.external_refund_reference AS "ExternalReference",
          r.execution_evidence_key AS "EvidenceKey", r.history::text AS "HistoryJson",
          (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')='true' OR
            EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) h WHERE h->>'recordType'='SecurityDepositRefundV1'
              AND h->'state'->>'isDevelopmentDemo'='true')) AS "IsDevelopmentDemo"
        FROM refund_requests r JOIN residents resident ON resident.id=r.beneficiary_resident_id
          LEFT JOIN payments p ON p.id=r.source_payment_id
        WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) h WHERE h->>'recordType' IN ({Kind},'SecurityDepositRefundV1'))
        """);
    private static RefundRecord Decode(RefundRecord row)
    {
        using var json = JsonDocument.Parse(row.HistoryJson);
        row.State = json.RootElement.EnumerateArray().Last(n => n.TryGetProperty("recordType", out var kind) && kind.GetString() is Kind or "SecurityDepositRefundV1")
            .GetProperty("state").Deserialize<RefundState>(Json) ?? throw new FinanceException(409, "refund_history_invalid");
        return row;
    }
    public async Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var result = await work(); await transaction.CommitAsync(t); return result;
    }
    public async Task<RefundRecord> GetAsync(Guid id, CancellationToken t) => Decode(await Rows.SingleOrDefaultAsync(r => r.Id == id, t)
        ?? throw new FinanceException(404, "refund_not_found"));
    public async Task<RefundRecord?> OperationAsync(Guid key, CancellationToken t)
    {
        if (await Rows.SingleOrDefaultAsync(r => r.OperationKey == key, t) is { } row) return Decode(row);
        if (await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM refund_requests WHERE operation_key={key}) AS \"Value\"").SingleAsync(t))
            throw new FinanceException(409, "refund_idempotency_conflict");
        return null;
    }
    public async Task<RefundSourceData> SourceAsync(Guid id, CancellationToken t)
    {
        if (!await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments WHERE id={id} AND status='VERIFIED') AS \"Value\"").SingleAsync(t))
            throw new FinanceException(404, "bank_transfer_not_found");
        var payment = await db.Set<PaymentTransfer>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, t)
            ?? throw new FinanceException(404, "bank_transfer_not_found");
        var allocation = await db.Set<PaymentAllocation>().AsNoTracking().SingleOrDefaultAsync(a => a.TransferId == id, t);
        var excess = payment.Amount - (allocation?.Amount ?? payment.Amount);
        var allReserved = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(requested_amount),0) AS "Value" FROM refund_requests
            WHERE source_payment_id={id} AND status IN ('REQUESTED','APPROVED','COMPLETED')
            """).SingleAsync(t);
        var requests = (await Rows.Where(r => r.SourcePaymentId == id).OrderByDescending(r => r.RequestedAt).ToArrayAsync(t)).Select(Decode).ToArray();
        // Do not hide reservations owned by another/legacy workflow from availability.
        if (allReserved != requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        var people = allocation?.PaidByUserId is not { } payer ? [] : await (
            from person in db.Set<Resident>().AsNoTracking()
            join invoice in db.Set<Invoice>().AsNoTracking() on person.RoomId equals invoice.RoomId
            where invoice.Id == allocation.InvoiceId && person.TenantUserId == payer &&
                person.VerificationStatus == IdentityVerificationStatus.Verified && invoice.Recipients.Any(r => r.TenantUserId == payer)
            orderby person.Id
            select new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
        return new(Math.Max(0, excess), payment.IsDevelopmentDemo, people, requests);
    }
    public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken t) => db.Database.SqlQuery<bool>($"""
        SELECT EXISTS(SELECT 1 FROM refund_requests r WHERE id<>{exceptId} AND (
          upper(external_refund_reference)={reference} OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(r.history) h
            WHERE h->>'recordType' IN ({Kind},'SecurityDepositRefundV1') AND h->'state'->'upload'->>'externalReference'={reference}))) AS "Value"
        """).SingleAsync(t);
    public async Task SaveAsync(RefundRecord row, bool create, Guid actor, string action, DateTimeOffset now, CancellationToken t)
    {
        var history = JsonNode.Parse(row.HistoryJson) as JsonArray ?? throw new FinanceException(409, "refund_history_invalid");
        history.Add(new JsonObject { ["recordType"] = row.State.Classification, ["state"] = JsonSerializer.SerializeToNode(row.State, Json) });
        var json = history.ToJsonString();
        if (create)
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,source_deposit_contract_id,beneficiary_resident_id,requested_by_user_id,
                  requested_at,requested_amount,reason,status,operation_key,version,history)
                VALUES({row.Id},{row.SourcePaymentId},{row.SourceDepositContractId},{row.BeneficiaryResidentId},{row.RequestedBy},{row.RequestedAt},
                  {row.Amount},{row.Reason},{row.Status},{row.OperationKey},{row.Version},{json}::jsonb)
                """, t);
        else
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE refund_requests SET status={row.Status},version={row.Version},decided_by_user_id={row.DecidedBy},
                  decided_at={row.DecidedAt},decision_reason={row.DecisionReason},executed_at={row.ExecutedAt},
                  external_refund_reference={row.ExternalReference},execution_evidence_key={row.EvidenceKey},history={json}::jsonb
                WHERE id={row.Id}
                """, t);
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = actor,
            TargetId = row.Id,
            TargetType = "Refund",
            Event = action,
            Succeeded = true,
            OccurredAt = now
        });
        await db.SaveChangesAsync(t);
    }
}
