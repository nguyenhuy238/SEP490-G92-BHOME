using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Contracts;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;
internal sealed partial class RefundRepository
{
    private async Task<RefundSourceData> HoldingRefundSourceAsync(RefundContractBasis contract, CancellationToken token)
    {
        var review = await db.Database.SqlQuery<HoldingRefundReview>($$"""
            SELECT COALESCE((e->>'id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "Id",
                COALESCE(e->>'decision','') AS "Decision",e->>'ledgerReference' AS "LedgerReference",
                COALESCE((e->>'financialSnapshot')::jsonb,'{}'::jsonb)::text AS "FinancialSnapshot",
                COALESCE((e->>'reviewedAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "ReviewedAt"
            FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.settlement->'reviews','[]'::jsonb)) e
            WHERE COALESCE((e->>'contractId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)={{contract.Id}}
                AND e->>'decision' IN ('HoldingRefundRequired','HoldingDepositForfeited')
            """).OrderByDescending(r => r.ReviewedAt).FirstOrDefaultAsync(token);
        var decision = HoldingCancellationRules.DecodeSnapshot(review?.FinancialSnapshot);
        var reference = review is null ? "" : HoldingCancellationRules.Reference(contract.Id, review.Id, review.Decision, review.FinancialSnapshot);
        var position = await new ContractDepositPosition(db).ReadAsync([contract.Id], token, reference);
        var blockers = new List<string>();
        if (contract.Status != (short)ContractStatus.Cancelled || decision is null || review?.LedgerReference != reference ||
            decision.Cause == HoldingCancellationCause.OwnerCannotProvideRoom && review.Decision != "HoldingRefundRequired") blockers.Add("holding_cancellation_review_required");
        else if (decision.Cause != HoldingCancellationCause.OwnerCannotProvideRoom || decision.ForfeitedAmount != 0 || decision.RefundRequired != decision.VerifiedDeposit)
            blockers.Add("holding_deposit_forfeited");
        if (position is null || position.Received != decision?.VerifiedDeposit || position.Allocated != 0 || position.UnclassifiedRefunds != 0 ||
            position.Refunded < 0 || position.Reserved < 0 || position.Refunded + position.Reserved > position.Received)
            blockers.Add("holding_deposit_requires_manual_review");
        var requests = (await Rows.Where(r => r.SourceDepositContractId == contract.Id).OrderByDescending(r => r.RequestedAt).ToArrayAsync(token)).Select(Decode).ToArray();
        var allReserved = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(requested_amount),0) AS "Value" FROM refund_requests
            WHERE source_deposit_contract_id={contract.Id} AND status IN ('REQUESTED','APPROVED','COMPLETED')
            """).SingleAsync(token);
        if (allReserved != requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount)) blockers.Add("refund_source_requires_manual_review");
        var people = await db.Set<Native.Resident>().AsNoTracking().Where(r => r.VerificationStatus == (short)IdentityVerificationStatus.Verified &&
            db.Set<Native.ContractResident>().Any(cr => cr.ContractId == contract.Id && cr.ResidentId == r.Id)).OrderBy(r => r.Id)
            .Select(r => new RefundPerson(r.Id, r.DisplayLabel)).ToArrayAsync(token);
        return new(decision?.RefundRequired ?? 0, contract.PaymentMode == "Test", people, requests, contract.Id, reference,
            blockers.Distinct().Order().ToArray(), position is null ? null : Math.Max(0, (decision?.RefundRequired ?? 0) - position.Refunded - position.Reserved),
            position?.Received, DepositClassification: "HoldingDepositRefundV1");
    }
}

internal sealed class HoldingRefundReview
{
    public Guid Id { get; set; }
    public string Decision { get; set; } = "";
    public string? LedgerReference { get; set; }
    public string FinancialSnapshot { get; set; } = "{}";
    public DateTimeOffset ReviewedAt { get; set; }
}
