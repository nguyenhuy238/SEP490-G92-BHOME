using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Contracts;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;
internal sealed partial class RefundRepository
{
    private async Task<RefundSourceData> HoldingRefundSourceAsync(Contract contract, CancellationToken token)
    {
        var review = await db.Set<ContractSettlementReview>().AsNoTracking().Where(r => r.ContractId == contract.Id &&
            (r.Decision == "HoldingRefundRequired" || r.Decision == "HoldingDepositForfeited")).OrderByDescending(r => r.ReviewedAt).FirstOrDefaultAsync(token);
        var decision = HoldingCancellationRules.Decode(review);
        var reference = review is null ? "" : HoldingCancellationRules.Reference(contract.Id, review);
        var position = await new ContractDepositPosition(db).ReadAsync([contract.Id], token, reference);
        var blockers = new List<string>();
        if (contract.Status != ContractStatus.Cancelled || decision is null || review?.LedgerReference != reference ||
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
        var people = await db.Set<Resident>().AsNoTracking().Where(r => r.VerificationStatus == IdentityVerificationStatus.Verified &&
            db.Set<ContractResident>().Any(cr => cr.ContractId == contract.Id && cr.ResidentId == r.Id)).OrderBy(r => r.Id)
            .Select(r => new RefundPerson(r.Id, r.DisplayLabel)).ToArrayAsync(token);
        return new(decision?.RefundRequired ?? 0, contract.IsDevelopmentDemo, people, requests, contract.Id, reference,
            blockers.Distinct().Order().ToArray(), position is null ? null : Math.Max(0, (decision?.RefundRequired ?? 0) - position.Refunded - position.Reserved),
            position?.Received, DepositClassification: "HoldingDepositRefundV1");
    }
}
