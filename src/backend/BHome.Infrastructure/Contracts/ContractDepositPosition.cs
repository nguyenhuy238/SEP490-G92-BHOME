using BHome.Application.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractDepositPosition(BHomePersistenceContext db) : IContractDepositPosition
{
    public async Task<DepositLedgerPosition?> ReadAsync(Guid[] contractIds, CancellationToken token, string financialReference = "")
    {
        // Offline legacy regression has no source-deposit ledger. Never substitute zero for unknown funds.
        // Production DI only registers Compact24; this does not connect to or fall back to a legacy database.
        if (db is not Compact24DbContext) return null;
        return await db.Database.SqlQuery<DepositLedgerPosition>($"""
            SELECT
              COALESCE((SELECT sum(amount) FROM payment_allocations
                WHERE target_deposit_contract_id = ANY({contractIds})),0) AS "Received",
              COALESCE((SELECT sum(amount) FROM payment_allocations
                WHERE source_deposit_contract_id = ANY({contractIds})),0) AS "Allocated",
              COALESCE((SELECT sum(requested_amount) FROM refund_requests
                WHERE source_deposit_contract_id = ANY({contractIds}) AND status='COMPLETED'),0) AS "Refunded",
              COALESCE((SELECT sum(requested_amount) FROM refund_requests
                WHERE source_deposit_contract_id = ANY({contractIds}) AND status IN ('REQUESTED','APPROVED')),0) AS "Reserved",
              (SELECT count(*)::integer FROM refund_requests r
                WHERE source_deposit_contract_id = ANY({contractIds}) AND status IN ('REQUESTED','APPROVED','COMPLETED')
                AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.history) h
                  WHERE h->>'recordType'='SecurityDepositRefundV1'
                    AND h->'state'->>'sourceReference'={financialReference}
                    AND h->'state'->>'beneficiaryVerified'='true'
                    AND (h->'state'->>'noDeductionsConfirmed'='true' OR h->'state'->>'deductionsConfirmed'='true')
                    AND (r.status<>'COMPLETED' OR (
                      h->'state'->'upload'->>'objectKey'=r.execution_evidence_key
                      AND h->'state'->'upload'->>'externalReference'=r.external_refund_reference
                      AND h->'state'->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
                      AND EXISTS(SELECT 1 FROM jsonb_array_elements(h->'state'->'events') e WHERE e->>'action'='Completed'))))) AS "UnclassifiedRefunds"
            """).SingleAsync(token);
    }
}
