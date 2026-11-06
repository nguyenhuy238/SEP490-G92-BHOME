using BHome.Application.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractDepositPosition(BHomePersistenceContext db) : IContractDepositPosition
{
    public async Task<DepositLedgerPosition?> ReadAsync(Guid[] contractIds, CancellationToken token)
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
                WHERE source_deposit_contract_id = ANY({contractIds}) AND status IN ('REQUESTED','APPROVED')),0) AS "Reserved"
            """).SingleAsync(token);
    }
}
