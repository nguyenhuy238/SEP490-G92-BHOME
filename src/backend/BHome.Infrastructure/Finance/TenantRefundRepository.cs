using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

internal sealed partial class RefundRepository
{
    public async Task<PagedResult<TenantRefundView>> TenantListAsync(Guid tenant, int page, int pageSize, CancellationToken token)
    {
        // Beneficiary identity is the entitlement. Current occupancy is deliberately irrelevant.
        // Project only public status metadata; never hydrate Owner proofs/audit notes for this API.
        var source = db.Database.SqlQuery<TenantRefundView>($"""
            SELECT r.id AS "Id", r.requested_amount AS "Amount",
              CASE latest.state->>'classification' WHEN 'ExcessReceiptRefundV1' THEN 'ReceiptExcess'
                WHEN 'SecurityDepositRefundV1' THEN 'SecurityDeposit' WHEN 'HoldingDepositRefundV1' THEN 'HoldingDeposit' END AS "SourceKind",
              r.status AS "Status", r.requested_at AS "RequestedAt", r.decided_at AS "DecidedAt", r.executed_at AS "ExecutedAt",
              (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')='true'
                OR COALESCE(latest.state->>'isDevelopmentDemo','false')='true') AS "IsDevelopmentDemo"
            FROM refund_requests r JOIN residents person ON person.id=r.beneficiary_resident_id
              LEFT JOIN payments p ON p.id=r.source_payment_id
              JOIN LATERAL (SELECT h->'state' AS state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
                WHERE h->>'recordType' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1')
                ORDER BY n DESC LIMIT 1) latest ON true
            WHERE person.user_id={tenant} AND latest.state->>'classification' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1')
            """);
        var total = await source.CountAsync(token);
        var items = await source.OrderByDescending(r => r.RequestedAt).ThenBy(r => r.Id).Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(token);
        return new(items, page, pageSize, total);
    }
}
