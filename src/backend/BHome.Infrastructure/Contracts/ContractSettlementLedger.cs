using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractSettlementLedger(BHomePersistenceContext db, IContractDepositPosition? positions = null,
    IPaymentRepository? payments = null, IDepositDeductionEvidence? deductionEvidence = null,
    ISettlementChargeEvidence? chargeEvidence = null) : IContractSettlementLedger, IContractSettlementDetails
{
    public async Task<SettlementLedgerState?> ReadAsync(Guid id, Guid electricity, Guid water, CancellationToken t)
    {
        var m = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == id, t);
        var summary = await SummaryAsync(id, t);
        if (summary.DepositDeductions is { } plan && summary.Resolved)
        {
            if (deductionEvidence is null) throw new ContractException(503, "deduction_evidence_unavailable");
            await deductionEvidence.VerifyAsync(plan, t);
        }
        if (summary.Resolved && summary.Receivables is { Count: > 0 })
        {
            if (chargeEvidence is null) throw new ContractException(503, "settlement_evidence_unavailable");
            foreach (var charge in summary.Receivables) await chargeEvidence.VerifyAsync(charge.Charge, t);
        }
        var valid = m?.ElectricityReadingId == electricity && m.WaterReadingId == water && summary.Resolved;
        return new(valid, valid, valid, summary.Reference);
    }
    public async Task<ContractSettlementSummary> SummaryAsync(Guid id, CancellationToken t)
    {
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == id, t) ?? throw ContractException.Missing();
        var chain = new List<Contract> { c }; var root = c; var visited = new HashSet<Guid> { id };
        while (root.PreviousContractId is { } parent)
        {
            if (!visited.Add(parent) || chain.Count >= 100) throw ContractException.Conflict("contract_version_integrity_failed");
            root = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == parent, t); chain.Add(root);
            if (root.RoomId != c.RoomId || root.TenantUserId != c.TenantUserId) throw ContractException.Conflict("contract_version_integrity_failed");
        }
        var blockers = new List<string>(); var m = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == id, t);
        var charges = await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, id, SettlementChargeRecords.ChargeKind, t);
        if (await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingAsync(db, null, id, t) ||
            await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingAllocatedSettlementAsync(db, id, t) ||
            await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingDepositAsync(db, chain.Select(v => v.Id).Append(root.HoldingContractId ?? root.Id).Distinct().ToArray(), t)) blockers.Add("receipt_excess_refund_pending");
        var chargeBalances = new List<SettlementReceivableBalance>();
        foreach (var charge in charges)
        {
            var paid = await db.Set<PaymentAllocation>().Where(a => a.TargetSettlementContractId == id && a.SettlementReceivableId == charge.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
            if (paid < 0 || paid > charge.Amount) throw ContractException.Conflict("settlement_ledger_integrity_failed");
            chargeBalances.Add(new(charge, paid, charge.Amount - paid, paid == charge.Amount ? "Paid" : paid == 0 ? "Unpaid" : "PartiallyPaid"));
            if (paid < charge.Amount) blockers.Add("settlement_receivable_outstanding");
        }
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(t);
        var review = (await SettlementChargeRecords.ReadAsync<SettlementChargeReview>(db, id, SettlementChargeRecords.ReviewKind, t)).OrderByDescending(r => r.ApprovedAt).FirstOrDefault();
        var reviewReference = SettlementChargeReviewRules.Reference(id, inspection, charges);
        var reviewedCharges = charges.Length > 0 && review?.SourceReference == reviewReference;
        if (charges.Length > 0 && !reviewedCharges) blockers.Add("final_charge_review_required");
        HandoverSnapshot? observed = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        if (m?.ApprovedAt is null) blockers.Add("owner_termination_approval_required");
        if (inspection?.OwnerDecision != "Confirmed") blockers.Add("owner_confirmed_inspection_required");
        if (inspection?.NoAdditionalCharges != true && !reviewedCharges) blockers.Add("final_charges_and_damage_policy_pending");
        if (inspection is null) blockers.Add("confirmed_handover_baseline_required");
        var end = observed?.Date ?? m?.ProposedDate ?? c.EndDate;
        var start = new DateOnly(root.StartDate.Year, root.StartDate.Month, 1); var through = new DateOnly(end.Year, end.Month, 1);
        if (through < start || through.Year - start.Year > 20) throw ContractException.Conflict("settlement_period_review_required");
        var deposits = await db.Set<DepositVerification>().AsNoTracking().Where(d => d.ContractId == root.Id).OrderBy(d => d.Id).Select(d => new { d.Id, d.Amount, d.VerifiedAt }).ToArrayAsync(t);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
        {
            var receipts = await db.Database.SqlQuery<SettlementDepositReceipt>($"""
                SELECT a.id AS "Id",a.amount AS "Amount",p.verified_at AS "VerifiedAt" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
                WHERE a.target_deposit_contract_id={root.Id} AND p.status='VERIFIED'
                  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositVerification')
                """).ToArrayAsync(t);
            // Preserve the exact legacy reference shape/IDs; add only canonical receipt allocations absent from that history.
            deposits = deposits.Concat(receipts.Select(d => new { d.Id, d.Amount, d.VerifiedAt })).OrderBy(d => d.Id).ToArray();
        }
        var deposit = decimal.Truncate(deposits.Sum(d => d.Amount) + root.AppliedHoldingDeposit);
        if (deposit > 0 || chain.Any(c => c.RequiredDeposit > 0)) blockers.Add("deposit_deduction_refund_policy_required");
        if (root.HoldingContractId is { } holding)
        {
            var applied = await db.Set<PaymentAllocation>().Where(a => a.SourceDepositContractId == holding && a.TargetDepositContractId == root.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
            if (applied != root.AppliedHoldingDeposit) blockers.Add("holding_allocation_settlement_required");
        }
        else if (root.AppliedHoldingDeposit > 0) blockers.Add("holding_allocation_settlement_required");
        var invoiceEntities = await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).Where(i => i.RoomId == c.RoomId && i.BillingPeriod >= start && i.BillingPeriod <= through).OrderBy(i => i.BillingPeriod).ToArrayAsync(t);
        if (invoiceEntities.Length > 250) throw ContractException.Conflict("settlement_period_review_required");
        var ids = invoiceEntities.Select(i => i.Id).ToArray();
        var allRecipients = await db.Set<InvoiceRecipient>().AsNoTracking().Where(r => ids.Contains(r.InvoiceId)).ToArrayAsync(t);
        var invoices = new List<SettlementInvoice>();
        foreach (var month in Enumerable.Range(0, (through.Year - start.Year) * 12 + through.Month - start.Month + 1).Select(n => start.AddMonths(n)))
            if (!(month == through && reviewedCharges && charges.Any(ch => ch.FixedCharge is { Category: "Rent" } fixedCharge && fixedCharge.BillingPeriod == month)) &&
                !invoiceEntities.Any(i => i.BillingPeriod == month && i.Status == InvoiceStatus.Final && allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId))) blockers.Add("final_invoice_coverage_required:" + month.ToString("yyyy-MM"));
        foreach (var invoice in invoiceEntities.Where(i => allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId)))
        {
            if (invoice.Status != InvoiceStatus.Final) { if (!(reviewedCharges && invoice.BillingPeriod == through)) blockers.Add("draft_invoice_pending"); continue; }
            var finances = await db.FinancialsAsync(invoice.Id, t); var shared = allRecipients.Count(r => r.InvoiceId == invoice.Id) > 1;
            invoices.Add(new(invoice.Id, invoice.BillingPeriod, shared, finances));
            if (finances.OutstandingAmount > 0) blockers.Add("invoice_outstanding");
            if (finances.PotentialExcessAmount > 0) blockers.Add("invoice_excess_pending_review");
            if (payments is not null && await payments.PendingReviewAsync(invoice.Id, t)) blockers.Add("bank_transfer_pending_review");
        }
        if (await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => ids.Contains(r.InvoiceId) && r.Decision == null, t)) blockers.Add("invoice_adjustment_pending");
        if (await db.Set<PaymentReconciliation>().AnyAsync(r => r.InvoiceId != null && ids.Contains(r.InvoiceId.Value) && r.Decision == "PendingReview" &&
            !db.Set<PaymentReconciliation>().Any(n => n.TransferId == r.TransferId && n.Sequence > r.Sequence) && !db.Set<PaymentAllocation>().Any(a => a.TransferId == r.TransferId), t)) blockers.Add("bank_transfer_pending_review");
        if (observed is not null)
        {
            foreach (var final in new[] { observed.Electricity, observed.Water })
            {
                if (charges.Any(charge => charge.Utility is { } source && source.Final.ReadingId == final.Id &&
                    source.Final.Value == final.Value && source.Final.Date == final.Date)) continue;
                var billed = invoiceEntities.Where(i => i.Status == InvoiceStatus.Final && i.BillingPeriod == through).SelectMany(i => i.Lines)
                    .SingleOrDefault(l => l.Category == (final.UtilityType == 0 ? BHome.Domain.PropertyManagement.ChargeCategory.Electricity : BHome.Domain.PropertyManagement.ChargeCategory.Water));
                var reading = billed?.MeterReadingId is { } readingId ? await db.Set<MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == readingId, t) : null;
                var task = reading is null ? null : await db.Set<OperationalTask>().AsNoTracking().SingleOrDefaultAsync(task => task.Id == reading.TaskId, t);
                var observation = await db.Set<MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == final.Id, t);
                if (reading is null || task?.ReadingDate != final.Date || reading.ConfirmedValue != final.Value || observation?.MeterId != reading.MeterId || observation.ConfirmedValue != final.Value)
                    blockers.Add("unbilled_final_usage_pending:" + final.UtilityType);
            }
        }
        else blockers.Add("final_meter_readings_required");
        var other = await db.Set<Contract>().AnyAsync(o => o.RoomId == c.RoomId && o.Id != id && o.Status == ContractStatus.Active, t);
        // Obligation reference excludes this workflow's refund reservations/completions: reserving the
        // approved return must not invalidate its own approval. All charge/payment/inspection inputs remain bound.
        var obligationReference = "DEPOSIT-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            Contract = id,
            Root = root.Id,
            root.RequiredDeposit,
            root.AppliedHoldingDeposit,
            deposits,
            Invoices = invoices,
            Charges = chargeBalances,
            Blockers = blockers.Where(b => b != "deposit_deduction_refund_policy_required").Distinct().Order().ToArray(),
            Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges },
            ChargeReview = reviewedCharges ? review!.Id : (Guid?)null,
            Readings = m is null ? null : new { m.ElectricityReadingId, m.WaterReadingId }
        })));
        var plan = await DepositDeductionRecords.LatestAsync(db, id, t);
        var planValid = plan is not null && inspection is not null && plan.ObligationReference == obligationReference && plan.DepositContractId == root.Id &&
            plan.InspectionId == inspection.Id && plan.InspectionVersion == inspection.Version && inspection.OwnerDecision == "Confirmed" &&
            !inspection.NoAdditionalCharges && plan.Total >= 0 && plan.Total == plan.Items.Sum(i => i.Amount);
        if (plan is not null && !planValid) blockers.Add("deposit_deduction_reapproval_required");
        if (planValid) blockers.Remove("final_charges_and_damage_policy_pending");
        var financialReference = plan is null ? obligationReference : "DEPOSIT-" + Convert.ToHexString(SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(new { obligationReference, plan.Id, plan.Version, plan.Total })));
        var position = positions is null ? null : await positions.ReadAsync(chain.Select(v => v.Id).ToArray(), t, financialReference);
        var deductions = plan?.Total ?? 0;
        var calculation = SettlementCalculator.Calculate(invoices, deposit, position, deductions);
        if (position is not null && !calculation.DepositPositionConsistent) blockers.Add("deposit_ledger_reconciliation_required");
        if (position?.UnclassifiedRefunds > 0) blockers.Add("deposit_refund_manual_review_required");
        var approvedOffsets = new List<DepositOffsetApproval>();
        foreach (var version in chain) approvedOffsets.AddRange(await SettlementChargeRecords.ReadAsync<DepositOffsetApproval>(db, version.Id, SettlementChargeRecords.OffsetKind, t));
        var offsetIds = approvedOffsets.Where(o => o.SourceDepositContractId == root.Id).Select(o => o.Id).ToArray();
        var canonicalOffsets = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? await db.Set<PaymentAllocation>().Where(a => a.SourceDepositContractId == root.Id && a.DepositOffsetApprovalId != null && offsetIds.Contains(a.DepositOffsetApprovalId.Value))
            .SumAsync(a => (decimal?)a.Amount, t) ?? 0 : 0;
        if (canonicalOffsets != approvedOffsets.Where(o => o.SourceDepositContractId == root.Id).Sum(o => o.Amount)) blockers.Add("deposit_offset_reconciliation_required");
        if (position is not null && position.Allocated != canonicalOffsets) blockers.Add("deposit_offset_reconciliation_required");
        var returned = deposit > 0 && position is { Reserved: 0, UnclassifiedRefunds: 0 } && position.Allocated == canonicalOffsets &&
            position.Refunded + deductions + canonicalOffsets == deposit && calculation.DepositPositionConsistent && (reviewedCharges || inspection?.NoAdditionalCharges == true || planValid);
        if (returned) blockers.Remove("deposit_deduction_refund_policy_required");
        var resolved = blockers.Count == 0;
        var value = new ContractSettlementSummary(id, root.Id, c.RoomId, c.Room.RoomNumber, c.TenantUserId ?? throw ContractException.Conflict("active_tenant_account_required"), deposit, root.AppliedHoldingDeposit,
            calculation.ContractSpecificOutstanding, planValid ? deductions : inspection?.NoAdditionalCharges == true ? 0 : null,
            planValid ? deductions : deposit == 0 || returned ? 0 : null,
            returned ? position!.Refunded : deposit == 0 && root.AppliedHoldingDeposit == 0 ? 0 : null,
            invoices, blockers.Distinct().Order().ToArray(), other, resolved, "",
            returned ? position!.Refunded > 0 ? "VerifiedManual" : "NotRequired" : deposit == 0 && root.AppliedHoldingDeposit == 0 ? "NotRequired" : "PendingReview",
            calculation, financialReference, plan, obligationReference, chargeBalances, reviewedCharges ? review : null, canonicalOffsets);
        if (charges.Length > 0) value = value with { ApprovedFinalCharges = charges.Sum(charge => charge.Amount) };
        // Snapshot identity includes sources and their revisions, no user supplied financial totals.
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { value, Root = root.Id, root.RequiredDeposit, deposits, Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges }, Readings = m is null ? null : new { m.ElectricityReadingId, m.WaterReadingId } })));
        return value with { Reference = "BH40-" + fingerprint };
    }
}

internal sealed record SettlementDepositReceipt(Guid Id, decimal Amount, DateTimeOffset VerifiedAt);
