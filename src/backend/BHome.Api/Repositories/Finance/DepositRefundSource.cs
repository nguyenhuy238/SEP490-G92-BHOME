using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;

internal sealed partial class RefundRepository
{
    public async Task<RefundSourceData> DepositSourceAsync(Guid contractId, CancellationToken t)
    {
        var contract = await db.Database.SqlQuery<RefundContractBasis>($"""
            SELECT c.id AS "Id",c.contract_type AS "ContractType",c.status AS "Status",
                COALESCE(s.data->>'paymentMode',CASE WHEN COALESCE((s.data->>'isDevelopmentDemo')::boolean,false)
                    THEN 'Test' ELSE 'Live' END) AS "PaymentMode"
            FROM contracts c LEFT JOIN LATERAL (
                SELECT h->'state' AS data FROM jsonb_array_elements(c.history) WITH ORDINALITY e(h,n)
                WHERE h->>'recordType'='Contract' ORDER BY n DESC LIMIT 1) s ON true
            WHERE c.id={contractId} AND c.contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM')
            """).SingleOrDefaultAsync(t) ?? throw new FinanceException(404, "contract_not_found");
        if (contract.ContractType == "HOLDING") return await HoldingRefundSourceAsync(contract, t);
        if (ledger is not IContractSettlementDetails details) throw new FinanceException(503, "settlement_summary_unavailable");
        var summary = await details.SummaryAsync(contractId, t);
        var blockers = summary.UnresolvedItems.Where(b => b != "deposit_deduction_refund_policy_required").ToList();
        if ((ContractStatus)contract.Status is not (ContractStatus.Active or ContractStatus.Terminated)) blockers.Add("deposit_contract_not_active");
        if (summary.VerifiedSecurityDeposit <= 0 || summary.Calculation?.DepositPositionConsistent != true ||
            summary.Calculation.DepositAllocated != summary.ApprovedDepositOffsets) blockers.Add("deposit_source_requires_review");
        if (summary.DepositDeductions is { } plan)
        {
            if (summary.ApprovedDeductions != plan.Total + summary.MaintenanceDeductions || summary.ApprovedFinalCharges != plan.Total + summary.MaintenanceDeductions)
                blockers.Add("deposit_deductions_require_review");
            else
            {
                if (deductionEvidence is null) throw new FinanceException(503, "deduction_evidence_unavailable");
                await deductionEvidence.VerifyAsync(plan, t);
            }
        }
        else if (summary.Receivables is { Count: > 0 })
        {
            // Unpaid receivables already produce the separate
            // settlement_receivable_outstanding blocker in SummaryAsync.
            // Duplicating that as a missing source review would incorrectly
            // reject an Owner final-close that leaves TenantDamage overage on
            // the SAME receivable after exhausting the verified deposit.
            if (summary.ChargeReview is null) blockers.Add("settlement_charge_sources_incomplete");
            if (chargeEvidence is null) throw new FinanceException(503, "settlement_evidence_unavailable");
            foreach (var charge in summary.Receivables) await chargeEvidence.VerifyAsync(charge.Charge, t);
        }
        else if (summary.ApprovedFinalCharges != summary.MaintenanceDeductions) blockers.Add("deposit_deductions_require_review");
        var requests = (await Rows.Where(r => r.SourceDepositContractId == summary.DepositContractId)
            .OrderByDescending(r => r.RequestedAt).ToArrayAsync(t)).Select(Decode).ToArray();
        var allReserved = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(requested_amount),0) AS "Value" FROM refund_requests
            WHERE source_deposit_contract_id={summary.DepositContractId} AND status IN ('REQUESTED','APPROVED','COMPLETED')
            """).SingleAsync(t);
        if (allReserved != requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount))
            blockers.Add("refund_source_requires_manual_review");
        var people = await db.Set<Native.Resident>().AsNoTracking().Where(r =>
            r.UserId != null && r.VerificationStatus == (short)IdentityVerificationStatus.Verified &&
            db.Set<Native.ContractResident>().Any(cr => cr.ContractId == contractId && cr.ResidentId == r.Id))
            .OrderBy(r => r.Id).Select(r => new RefundPerson(r.Id, r.DisplayLabel)).ToArrayAsync(t);
        // BR-30: the Owner confirms the recipient under the Contract agreement. These choices
        // are eligible Residents, not an inference about who originally paid the deposit.
        return new(summary.VerifiedSecurityDeposit - (summary.DepositDeductions?.Total ?? 0) - summary.MaintenanceDeductions - summary.ApprovedDepositOffsets, contract.PaymentMode == "Test", people, requests,
            summary.DepositContractId, summary.FinancialReference, blockers.Distinct().Order().ToArray(), summary.Calculation?.AvailableSecurityDeposit,
            summary.VerifiedSecurityDeposit, summary.DepositDeductions, summary.ApprovedDepositOffsets, MaintenanceDeductions: summary.MaintenanceDeductions);
    }
}

internal sealed class RefundContractBasis
{
    public Guid Id { get; set; }
    public string ContractType { get; set; } = "";
    public short Status { get; set; }
    public string PaymentMode { get; set; } = "";
}
