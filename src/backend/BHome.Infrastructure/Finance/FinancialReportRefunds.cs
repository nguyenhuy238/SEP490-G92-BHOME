using BHome.Application.Finance;
using Microsoft.EntityFrameworkCore;
using BHome.Domain.TenantContracts;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    // A classified principal return never changes the invoice/OPEX reporting basis.
    // Unknown refunds retain the existing chain-wide guard. Read-only metadata, no file downloads
    // per report row; the execution workflow verified storage bytes before durable completion.
    private Task<RefundAccounting> RefundAccountingAsync(ReportFilter filter, DateTimeOffset start,
        DateTimeOffset end, CancellationToken token) => db.Database.SqlQuery<RefundAccounting>($"""
        WITH completed AS (
          SELECT r.*,latest.state FROM refund_requests r
          LEFT JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
            WHERE h->>'recordType' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1') ORDER BY n DESC LIMIT 1) latest ON true
          WHERE r.status='COMPLETED' AND (r.executed_at IS NULL OR r.executed_at<{end})
        ), classified AS (
          SELECT r.*,CASE WHEN r.executed_at IS NOT NULL
            AND r.state->'upload'->>'objectKey'=r.execution_evidence_key
            AND r.state->'upload'->>'externalReference'=r.external_refund_reference
            AND r.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.state->'events')='array'
              THEN r.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed')
          THEN CASE
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
        SELECT EXISTS(SELECT 1 FROM classified WHERE category IS NULL) AS "HasUnclassified",
          COALESCE((SELECT sum(r.requested_amount) FROM classified r
            JOIN contracts c ON c.id=r.source_deposit_contract_id JOIN rooms room ON room.id=c.room_id
            WHERE r.category='DepositPrincipal' AND r.executed_at>={start}
              AND COALESCE(r.state->>'isDevelopmentDemo','false')<>'true'
              AND ({filter.LocationId}::uuid IS NULL OR room.location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room.id={filter.RoomId})),0) AS "DepositReturned"
        """).SingleAsync(token);
}

public sealed class RefundAccounting
{
    public bool HasUnclassified { get; set; }
    public decimal DepositReturned { get; set; }
}
