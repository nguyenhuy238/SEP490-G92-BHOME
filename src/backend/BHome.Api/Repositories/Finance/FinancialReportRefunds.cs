using BHome.Application.Finance;
using Microsoft.EntityFrameworkCore;
using BHome.Domain.TenantContracts;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    // A classified principal return never changes the invoice/OPEX reporting basis.
    // Unknown refunds retain the existing chain-wide guard. Read-only metadata, no file downloads
    // per report row; the execution workflow verified storage bytes before durable completion.
    private IQueryable<ClassifiedRefundData> ClassifiedRefundRows(ReportFilter filter, DateTimeOffset start,
        DateTimeOffset end) => db.Database.SqlQuery<ClassifiedRefundData>($"""
        SELECT * FROM (
        WITH completed AS (
          SELECT r.*,latest.state FROM refund_requests r
          LEFT JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
            WHERE h->>'recordType' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1') ORDER BY n DESC LIMIT 1) latest ON true
          WHERE r.status='COMPLETED' AND (r.executed_at IS NULL OR r.executed_at<{end})
            -- Petition confirmations do not become verified source-ledger refunds.
            AND NOT (r.source_payment_id IS NULL AND r.source_deposit_contract_id IS NULL
              AND r.history @> jsonb_build_array(jsonb_build_object('recordType','TenantRefundPetitionV1')))
        ), classified AS (
          SELECT r.*,CASE WHEN r.executed_at IS NOT NULL
            AND r.state->'upload'->>'objectKey'=r.execution_evidence_key
            AND r.state->'upload'->>'externalReference'=r.external_refund_reference
            AND r.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.state->'events')='array'
              THEN r.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed')
          THEN CASE
            WHEN r.source_payment_id IS NOT NULL AND r.source_deposit_contract_id IS NULL AND (bhome24_external_refund_valid(r.id) OR bhome24_deposit_refund_valid(r.id))
              THEN 'ReceiptExcess'
            WHEN r.source_payment_id IS NOT NULL AND r.source_deposit_contract_id IS NULL
              AND r.state->>'classification'='ExcessReceiptRefundV1' AND EXISTS(
                SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
                JOIN residents person ON person.id=r.beneficiary_resident_id
                WHERE p.id=r.source_payment_id AND p.status='VERIFIED' AND (a.target_invoice_id IS NOT NULL OR EXISTS(
                  SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                  WHERE c.id=a.target_settlement_contract_id AND h->>'recordType'='SettlementReceivableV1'
                    AND h->>'recordKey'=a.settlement_receivable_id::text AND h->'state'->'recipientUserIds' @> jsonb_build_array(a.paid_by_user_id::text)))
                  AND a.paid_by_user_id=person.user_id
                  AND p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id)
                    >= (SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
              THEN 'ReceiptExcess'
            WHEN r.source_payment_id IS NOT NULL AND r.source_deposit_contract_id IS NULL AND r.state->>'classification'='ExcessReceiptRefundV1'
              AND EXISTS(SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
                JOIN residents person ON person.id=r.beneficiary_resident_id
                WHERE p.id=r.source_payment_id AND p.status='VERIFIED' AND h->>'recordType'='ReceiptExcessDispositionV1'
                  AND h->'state'->>'id'=r.state->>'receiptExcessDispositionId' AND h->'state'->>'transferId'=p.id::text
                  AND h->'state'->>'payerResidentId'=person.id::text
                  AND (h->'state'->>'payerUserId' IS NULL OR h->'state'->>'payerUserId'=person.user_id::text)
                  AND (h->'state'->>'amount')::numeric=p.amount
                  AND NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id)
                  AND p.amount>=(SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
              THEN 'ReceiptExcess'
            WHEN r.source_payment_id IS NULL AND r.source_deposit_contract_id IS NOT NULL
              AND r.state->>'classification'='SecurityDepositRefundV1'
              AND r.state->>'beneficiaryVerified'='true'
              AND r.state->>'sourceReference' ~ {"^DEPOSIT-[A-F0-9]{64}$"}
              AND EXISTS(SELECT 1 FROM contracts root
                JOIN contracts settlement ON settlement.id::text=r.state->>'settlementContractId'
                JOIN contract_residents person ON person.contract_id=settlement.id AND person.resident_id=r.beneficiary_resident_id
                LEFT JOIN LATERAL (SELECT h->'state' plan FROM jsonb_array_elements(settlement.history) WITH ORDINALITY e(h,n)
                  WHERE h->>'recordType'='DepositDeductionV1' ORDER BY n DESC LIMIT 1) decision ON true
                WHERE root.id=r.source_deposit_contract_id AND root.contract_type='MAIN' AND root.room_id=settlement.room_id
                  AND ((r.state->>'noDeductionsConfirmed'='true' AND COALESCE(r.state->>'deductionsConfirmed','false')='false'
                        AND r.state->>'deductionPlanId' IS NULL)
                    OR (r.state->>'deductionsConfirmed'='true' AND r.state->>'noDeductionsConfirmed'='false'
                        AND decision.plan->>'id'=r.state->>'deductionPlanId' AND decision.plan->>'depositContractId'=root.id::text)
                    OR (r.state->>'deductionsConfirmed'='true' AND r.state->>'noDeductionsConfirmed'='false' AND r.state->>'deductionPlanId' IS NULL
                        AND EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_deposit_contract_id=root.id AND a.deposit_offset_approval_id IS NOT NULL)
                        AND NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_deposit_contract_id=root.id AND
                          (a.deposit_offset_approval_id IS NULL OR NOT EXISTS(
                            SELECT 1 FROM contracts scoped CROSS JOIN LATERAL jsonb_array_elements(scoped.history) h
                            WHERE scoped.room_id=root.room_id AND h->>'recordType'='DepositOffsetApprovalV1'
                              AND h->'state'->>'id'=a.deposit_offset_approval_id::text AND h->'state'->>'allocationId'=a.id::text
                              AND h->'state'->>'sourceDepositContractId'=root.id::text AND (h->'state'->>'amount')::numeric=a.amount)))))
                  AND (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.target_deposit_contract_id=root.id)
                    >= (SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr
                          WHERE rr.source_deposit_contract_id=root.id AND rr.status='COMPLETED')
                     + (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.source_deposit_contract_id=root.id)
                     + CASE WHEN r.state->>'noDeductionsConfirmed'='true' OR r.state->>'deductionPlanId' IS NULL THEN 0
                         WHEN decision.plan->>'total' ~ '^[0-9]+$' THEN (decision.plan->>'total')::numeric ELSE NULL END)
              THEN 'DepositPrincipal'
            WHEN r.source_payment_id IS NULL AND r.source_deposit_contract_id IS NOT NULL
              AND r.state->>'classification'='HoldingDepositRefundV1' AND r.state->>'beneficiaryVerified'='true'
              AND r.state->>'noDeductionsConfirmed'='true' AND COALESCE(r.state->>'deductionsConfirmed','false')='false'
              AND r.state->>'sourceReference' ~ {"^HOLDING-[A-F0-9]{64}$"}
              AND EXISTS(SELECT 1 FROM contracts holding
                JOIN contract_residents person ON person.contract_id=holding.id AND person.resident_id=r.beneficiary_resident_id
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(holding.settlement->'reviews','[]'::jsonb)) decision
                WHERE holding.id=r.source_deposit_contract_id AND holding.id::text=r.state->>'settlementContractId'
                  AND holding.contract_type='HOLDING' AND holding.status={(short)ContractStatus.Cancelled}
                  AND decision->>'recordType'='ContractSettlementReview' AND decision->>'decision'='HoldingRefundRequired'
                  AND decision->>'ledgerReference'=r.state->>'sourceReference'
                  AND (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.target_deposit_contract_id=holding.id)
                    >= (SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_deposit_contract_id=holding.id AND rr.status='COMPLETED')
                      + (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.source_deposit_contract_id=holding.id))
              THEN 'DepositPrincipal' END END category
          FROM completed r
        )
        SELECT r.id AS "Id",r.source_payment_id AS "PaymentId",r.executed_at AS "ExecutedAt",
          r.requested_amount AS "Amount",r.external_refund_reference AS "Reference",r.category AS "Category",
          COALESCE(r.category='DepositPrincipal' AND r.executed_at>={start}
              AND (COALESCE(r.state->>'isDevelopmentDemo','false')<>'true' OR bhome24_contract_payment_mode(c.id)='Test')
              AND NOT bhome24_contract_is_simulation(c.id)
              AND room.id IS NOT NULL
              AND ({filter.LocationId}::uuid IS NULL OR room.location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room.id={filter.RoomId}),false) AS "DepositInPeriod",
          COALESCE(r.category='ReceiptExcess' AND r.executed_at>={start} AND p.id IS NOT NULL
              AND (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true' OR p.provider_code='SEPAY:TEST'),false) AS "ExcessInPeriod"
        FROM classified r LEFT JOIN contracts c ON c.id=r.source_deposit_contract_id
          LEFT JOIN rooms room ON room.id=c.room_id LEFT JOIN payments p ON p.id=r.source_payment_id
        ) classified_results
        """);

    private async Task<RefundAccounting> RefundAccountingAsync(ReportFilter filter, DateTimeOffset start,
        DateTimeOffset end, CancellationToken token) =>
        await ClassifiedRefundRows(filter, start, end).GroupBy(r => 1).Select(g => new RefundAccounting
        {
            HasUnclassified = g.Any(r => r.Category == null),
            DepositReturned = g.Sum(r => r.DepositInPeriod ? r.Amount : 0),
            ExcessReturned = g.Sum(r => r.ExcessInPeriod ? r.Amount : 0)
        }).SingleOrDefaultAsync(token) ?? new();

    public async Task<BankRefundSourcePage> BankRefundSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        await using var snapshot = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, token);
        var start = new DateTimeOffset(filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var end = new DateTimeOffset(filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var query = ClassifiedRefundRows(filter, start, end).Where(r => r.ExcessInPeriod);
        var count = await query.LongCountAsync(token);
        var amount = await query.SumAsync(r => r.Amount, token);
        var rows = await query.OrderByDescending(r => r.ExecutedAt).ThenBy(r => r.Id)
            .Skip(checked((page - 1) * pageSize)).Take(pageSize).ToArrayAsync(token);
        await snapshot.CommitAsync(token);
        static string Money(decimal value) => value.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
        return new(rows.Select(r => new BankRefundSource(r.Id, r.PaymentId!.Value, r.ExecutedAt!.Value,
            Money(r.Amount), r.Reference)).ToArray(), count, page, pageSize, Money(amount), clock.GetUtcNow());
    }
}

public sealed class ClassifiedRefundData
{
    public Guid Id { get; set; }
    public Guid? PaymentId { get; set; }
    public DateTimeOffset? ExecutedAt { get; set; }
    public decimal Amount { get; set; }
    public string? Reference { get; set; }
    public string? Category { get; set; }
    public bool DepositInPeriod { get; set; }
    public bool ExcessInPeriod { get; set; }
}

public sealed class RefundAccounting
{
    public bool HasUnclassified { get; set; }
    public decimal DepositReturned { get; set; }
    public decimal ExcessReturned { get; set; }
}
