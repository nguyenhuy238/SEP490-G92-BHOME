using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

internal sealed partial class RefundRepository
{
    public async Task<RefundSourceData> DepositSourceAsync(Guid contractId, CancellationToken t)
    {
        var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == contractId, t)
            ?? throw new FinanceException(404, "contract_not_found");
        if (ledger is not IContractSettlementDetails details) throw new FinanceException(503, "settlement_summary_unavailable");
        var summary = await details.SummaryAsync(contractId, t);
        var blockers = summary.UnresolvedItems.Where(b => b != "deposit_deduction_refund_policy_required").ToList();
        if (contract.Status != ContractStatus.Active) blockers.Add("deposit_contract_not_active");
        if (summary.VerifiedSecurityDeposit <= 0 || summary.Calculation?.DepositPositionConsistent != true ||
            summary.Calculation.DepositAllocated != 0) blockers.Add("deposit_source_requires_review");
        if (summary.DepositDeductions is { } plan)
        {
            if (summary.ApprovedDeductions != plan.Total || summary.ApprovedFinalCharges != plan.Total)
                blockers.Add("deposit_deductions_require_review");
            else
            {
                if (deductionEvidence is null) throw new FinanceException(503, "deduction_evidence_unavailable");
                await deductionEvidence.VerifyAsync(plan, t);
            }
        }
        else if (summary.ApprovedFinalCharges != 0) blockers.Add("deposit_deductions_require_review");
        var requests = (await Rows.Where(r => r.SourceDepositContractId == summary.DepositContractId)
            .OrderByDescending(r => r.RequestedAt).ToArrayAsync(t)).Select(Decode).ToArray();
        var allReserved = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(requested_amount),0) AS "Value" FROM refund_requests
            WHERE source_deposit_contract_id={summary.DepositContractId} AND status IN ('REQUESTED','APPROVED','COMPLETED')
            """).SingleAsync(t);
        if (allReserved != requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount))
            blockers.Add("refund_source_requires_manual_review");
        var people = await db.Set<Resident>().AsNoTracking().Where(r => r.RoomId == contract.RoomId &&
            r.TenantUserId != null && r.VerificationStatus == IdentityVerificationStatus.Verified &&
            db.Set<ContractResident>().Any(cr => cr.ContractId == contractId && cr.ResidentId == r.Id))
            .OrderBy(r => r.Id).Select(r => new RefundPerson(r.Id, r.DisplayLabel)).ToArrayAsync(t);
        // Choices are eligible occupants, NOT inferred deposit payers. The Owner must explicitly verify
        // the original depositor before requesting; the attestation is retained in immutable refund history.
        return new(summary.VerifiedSecurityDeposit - (summary.DepositDeductions?.Total ?? 0), contract.IsDevelopmentDemo, people, requests,
            summary.DepositContractId, summary.FinancialReference, blockers.Distinct().Order().ToArray(), summary.Calculation?.AvailableSecurityDeposit,
            summary.VerifiedSecurityDeposit, summary.DepositDeductions);
    }
}
