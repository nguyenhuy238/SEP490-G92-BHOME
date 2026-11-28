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
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.PaymentsDebt;
using Native = BHome.Domain.Entities;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractSettlementLedger(BHomePersistenceContext db, IContractDepositPosition? positions = null,
    IPaymentRepository? payments = null, IDepositDeductionEvidence? deductionEvidence = null,
    ISettlementChargeEvidence? chargeEvidence = null, IMainInitialPaymentLedger? initialPayments = null) : IContractSettlementLedger, IContractSettlementDetails
{
    private async Task<(Contract DepositRoot, bool Deferred)> ResolveDepositAsync(Contract c, Contract root, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext || initialPayments is null)
            return (root, false);
        var order = await initialPayments.ReadAsync(root.Id, t);
        var anchor = order?.SharedDepositContractId ?? root.Id;
        var members = await db.Database.SqlQuery<Guid>($"""
            WITH RECURSIVE members(id) AS (
              SELECT {anchor}
              UNION
              SELECT (task_data->'state'->>'contractId')::uuid
              FROM operational_tasks
              WHERE task_data->>'recordType'='MainInitialPaymentV1'
                AND task_data->'state'->>'sharedDepositContractId'={anchor.ToString()}
            ), versions(id) AS (
              SELECT id FROM members
              UNION
              SELECT c.id FROM contracts c JOIN versions v ON c.previous_contract_id=v.id
            )
            SELECT id AS "Value" FROM versions
            """).ToArrayAsync(t);
        if (!members.Any(id => id != c.Id && id != root.Id) && anchor == root.Id) return (root, false);
        var otherOpen = await db.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(other => members.Contains(other.Id) && other.Id != c.Id &&
            (other.Status == ContractStatus.Active || other.Status == ContractStatus.Expired || other.Status == ContractStatus.PendingActivation), t);
        var lastCompleted = c.Status == ContractStatus.Terminated
            ? (await NativeContractMoveOutPersistence.MoveHistoryAsync((Compact24DbContext)db, members, t)).Where(h => h.Action == "Completed")
                .OrderByDescending(h => h.OccurredAt).ThenByDescending(h => h.Id).Select(h => (Guid?)h.ContractId).FirstOrDefault()
            : null;
        var depositRoot = anchor == root.Id ? root : (await NativeSettlementReads.ContractAsync(db, anchor, t) ?? throw new InvalidOperationException("Missing shared deposit contract."));
        return (depositRoot, otherOpen || c.Status == ContractStatus.Terminated && lastCompleted != c.Id);
    }
    public async Task<SettlementLedgerState?> ReadAsync(Guid id, Guid electricity, Guid water, CancellationToken t)
    {
        var m = await NativeSettlementReads.MoveAsync(db, id, t);
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
        var c = await NativeSettlementReads.ContractAsync(db, id, t) ?? throw ContractException.Missing();
        var chain = new List<Contract> { c }; var root = c; var visited = new HashSet<Guid> { id };
        while (root.PreviousContractId is { } parent)
        {
            if (!visited.Add(parent) || chain.Count >= 100) throw ContractException.Conflict("contract_version_integrity_failed");
            root = await NativeSettlementReads.ContractAsync(db, parent, t) ?? throw new InvalidOperationException("Missing previous contract."); chain.Add(root);
            if (root.RoomId != c.RoomId || root.TenantUserId != c.TenantUserId) throw ContractException.Conflict("contract_version_integrity_failed");
        }
        var (depositRoot, depositDeferred) = await ResolveDepositAsync(c, root, t);
        var depositIds = depositDeferred ? [] : chain.Select(v => v.Id).Append(depositRoot.Id).Distinct().ToArray();
        var blockers = new List<string>(); var m = await NativeSettlementReads.MoveAsync(db, id, t);
        var compensations = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext
            ? await NativeSettlementReads.CompensationsAsync(db, depositRoot.Id, t) : [];
        if (compensations.Any(c => c.Status == "DepositPending")) blockers.Add("maintenance_compensation_pending");
        var maintenanceDeductions = depositDeferred ? 0 : compensations.Where(c => c.Status == "Deducted").Sum(c => c.Amount);
        var charges = await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, id, SettlementChargeRecords.ChargeKind, t);
        if (await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingAsync(db, null, id, t, depositContractIds: chain.Select(v => v.Id).Append(root.HoldingContractId ?? root.Id).Distinct().ToArray()) ||
            await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingAllocatedSettlementAsync(db, id, t) ||
            await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingDepositAsync(db, chain.Select(v => v.Id).Append(root.HoldingContractId ?? root.Id).Distinct().ToArray(), t)) blockers.Add("receipt_excess_refund_pending");
        var chargeBalances = new List<SettlementReceivableBalance>();
        foreach (var charge in charges)
        {
            var paid = db is Compact24DbContext
                ? await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a => a.TargetSettlementContractId == id && a.SettlementReceivableId == charge.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0
                : await db.Set<PaymentAllocation>().Where(a => a.TargetSettlementContractId == id && a.SettlementReceivableId == charge.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
            if (paid < 0 || paid > charge.Amount) throw ContractException.Conflict("settlement_ledger_integrity_failed");
            chargeBalances.Add(new(charge, paid, charge.Amount - paid, paid == charge.Amount ? "Paid" : paid == 0 ? "Unpaid" : "PartiallyPaid"));
            if (paid < charge.Amount) blockers.Add("settlement_receivable_outstanding");
        }
        var inspection = await NativeSettlementReads.InspectionAsync(db, id, t);
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
        var deposits = db is Compact24DbContext
            ? (depositDeferred ? Array.Empty<SettlementDepositReceipt>() : await NativeSettlementReads.DepositReceiptsAsync(db, depositRoot.Id, t))
                .Select(d => new { d.Id, d.Amount, d.VerifiedAt }).ToArray()
            : await db.Set<DepositVerification>().AsNoTracking().Where(d => !depositDeferred && d.ContractId == depositRoot.Id).OrderBy(d => d.Id).Select(d => new { d.Id, d.Amount, d.VerifiedAt }).ToArrayAsync(t);
        if (!depositDeferred && db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
        {
            var receipts = await db.Database.SqlQuery<SettlementDepositReceipt>($"""
                SELECT a.id AS "Id",a.amount AS "Amount",p.verified_at AS "VerifiedAt" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
                WHERE a.target_deposit_contract_id={depositRoot.Id} AND p.status='VERIFIED'
                  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositVerification')
                """).ToArrayAsync(t);
            // Preserve the exact legacy reference shape/IDs; add only canonical receipt allocations absent from that history.
            deposits = deposits.Concat(receipts.Select(d => new { d.Id, d.Amount, d.VerifiedAt })).OrderBy(d => d.Id).ToArray();
        }
        var holdingCredit = depositDeferred ? 0 : depositRoot.AppliedHoldingDeposit;
        var deposit = decimal.Truncate(deposits.Sum(d => d.Amount) + holdingCredit);
        if (!depositDeferred && (deposit > 0 || depositRoot.RequiredDeposit > 0)) blockers.Add("deposit_deduction_refund_policy_required");
        if (!depositDeferred && depositRoot.HoldingContractId is { } holding)
        {
            var applied = db is Compact24DbContext
                ? await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a => a.SourceDepositContractId == holding && a.TargetDepositContractId == depositRoot.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0
                : await db.Set<PaymentAllocation>().Where(a => a.SourceDepositContractId == holding && a.TargetDepositContractId == depositRoot.Id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
            if (applied != holdingCredit) blockers.Add("holding_allocation_settlement_required");
        }
        else if (holdingCredit > 0) blockers.Add("holding_allocation_settlement_required");
        var chainIds = chain.Select(v => v.Id).ToArray();
        var invoiceEntities = db is Compact24DbContext native
            ? await NativeInvoicePersistence.ReadAsync(native, native.Set<BHome.Domain.Billing.Invoice>().AsNoTracking()
                .Where(i => i.RoomId == c.RoomId && i.BillingPeriod >= start && i.BillingPeriod <= through &&
                    (i.Type == "PERIODIC" || chainIds.Contains(i.RepresentativeContractId))).OrderBy(i => i.BillingPeriod).ThenBy(i => i.Id).Take(251), t)
            : await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).Where(i => i.RoomId == c.RoomId && i.BillingPeriod >= start && i.BillingPeriod <= through).OrderBy(i => i.BillingPeriod).ToArrayAsync(t);
        if (invoiceEntities.Length > 250) throw ContractException.Conflict("settlement_period_review_required");
        var ids = invoiceEntities.Select(i => i.Id).ToArray();
        var allRecipients = db is Compact24DbContext ? invoiceEntities.SelectMany(i => i.Recipients).ToArray()
            : await db.Set<InvoiceRecipient>().AsNoTracking().Where(r => ids.Contains(r.InvoiceId)).ToArrayAsync(t);
        var invoices = new List<SettlementInvoice>();
        foreach (var month in Enumerable.Range(0, (through.Year - start.Year) * 12 + through.Month - start.Month + 1).Select(n => start.AddMonths(n)))
            if (!(month == through && reviewedCharges && charges.Any(ch => ch.FixedCharge is { Category: "Rent" } fixedCharge && fixedCharge.BillingPeriod == month)) &&
                !invoiceEntities.Any(i => i.Type == "PERIODIC" && i.BillingPeriod == month && i.Status == InvoiceStatus.Final && allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId))) blockers.Add("final_invoice_coverage_required:" + month.ToString("yyyy-MM"));
        foreach (var invoice in invoiceEntities.Where(i => allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId)))
        {
            if (invoice.Status != InvoiceStatus.Final) { if (!(reviewedCharges && invoice.BillingPeriod == through)) blockers.Add("draft_invoice_pending"); continue; }
            var finances = await db.FinancialsAsync(invoice.Id, t); var shared = allRecipients.Count(r => r.InvoiceId == invoice.Id) > 1;
            invoices.Add(new(invoice.Id, invoice.BillingPeriod, shared, finances));
            if (finances.OutstandingAmount > 0) blockers.Add("invoice_outstanding");
            if (finances.PotentialExcessAmount > 0) blockers.Add("invoice_excess_pending_review");
            if (payments is not null && await payments.PendingReviewAsync(invoice.Id, t)) blockers.Add("bank_transfer_pending_review");
        }
        if (db is Compact24DbContext)
        {
            if (await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => ids.Contains(r.InvoiceId) && r.DecisionSnapshot == null, t)) blockers.Add("invoice_adjustment_pending");
            var reviews = PaymentLedgerQueries.Reviews(db);
            if (await reviews.AnyAsync(r => r.InvoiceId != null && ids.Contains(r.InvoiceId.Value) && r.Decision == "PendingReview" &&
                !reviews.Any(n => n.TransferId == r.TransferId && n.Sequence > r.Sequence) &&
                !db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TransferId == r.TransferId), t)) blockers.Add("bank_transfer_pending_review");
        }
        else
        {
            if (await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => ids.Contains(r.InvoiceId) && r.Decision == null, t)) blockers.Add("invoice_adjustment_pending");
            if (await db.Set<PaymentReconciliation>().AnyAsync(r => r.InvoiceId != null && ids.Contains(r.InvoiceId.Value) && r.Decision == "PendingReview" &&
                !db.Set<PaymentReconciliation>().Any(n => n.TransferId == r.TransferId && n.Sequence > r.Sequence) && !db.Set<PaymentAllocation>().Any(a => a.TransferId == r.TransferId), t)) blockers.Add("bank_transfer_pending_review");
        }
        if (observed is not null)
        {
            foreach (var final in new[] { observed.Electricity, observed.Water })
            {
                if (charges.Any(charge => charge.Utility is { } source && source.Final.ReadingId == final.Id &&
                    source.Final.Value == final.Value && source.Final.Date == final.Date)) continue;
                var billed = invoiceEntities.Where(i => i.Status == InvoiceStatus.Final && i.BillingPeriod == through).SelectMany(i => i.Lines)
                    .SingleOrDefault(l => l.Category == (final.UtilityType == 0 ? BHome.Domain.PropertyManagement.ChargeCategory.Electricity : BHome.Domain.PropertyManagement.ChargeCategory.Water));
                var reading = billed?.MeterReadingId is { } readingId ? await NativeSettlementReads.ReadingAsync(db, readingId, t) : null;
                var task = reading is null ? null : await NativeSettlementReads.TaskAsync(db, reading.TaskId, t);
                var observation = await NativeSettlementReads.ReadingAsync(db, final.Id, t);
                if (reading is null || task?.ReadingDate != final.Date || reading.ConfirmedValue != final.Value || observation?.MeterId != reading.MeterId || observation.ConfirmedValue != final.Value)
                    blockers.Add("unbilled_final_usage_pending:" + final.UtilityType);
            }
        }
        else blockers.Add("final_meter_readings_required");
        var other = db is Compact24DbContext
            ? await db.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(o => o.RoomId == c.RoomId && o.Id != id && o.Status == ContractStatus.Active, t)
            : await db.Set<Contract>().AnyAsync(o => o.RoomId == c.RoomId && o.Id != id && o.Status == ContractStatus.Active, t);
        // Obligation reference excludes this workflow's refund reservations/completions: reserving the
        // approved return must not invalidate its own approval. All charge/payment/inspection inputs remain bound.
        var obligationReference = "DEPOSIT-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            Contract = id,
            Root = depositRoot.Id,
            depositRoot.RequiredDeposit,
            AppliedHoldingDeposit = holdingCredit,
            deposits,
            Invoices = invoices,
            Charges = chargeBalances,
            Blockers = blockers.Where(b => b != "deposit_deduction_refund_policy_required").Distinct().Order().ToArray(),
            Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges },
            ChargeReview = reviewedCharges ? review!.Id : (Guid?)null,
            Readings = m is null ? null : new { m.ElectricityReadingId, m.WaterReadingId }
        })));
        var plan = await DepositDeductionRecords.LatestAsync(db, id, t);
        if (compensations.Length > 0)
            obligationReference = "DEPOSIT-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                obligationReference,
                Maintenance = compensations.OrderBy(c => c.Id).Select(c => new { c.Id, c.Version, c.Status, c.Amount, c.DeductedAt })
            })));
        var planValid = plan is not null && inspection is not null && plan.ObligationReference == obligationReference && plan.DepositContractId == depositRoot.Id &&
            plan.InspectionId == inspection.Id && plan.InspectionVersion == inspection.Version && inspection.OwnerDecision == "Confirmed" &&
            !inspection.NoAdditionalCharges && plan.Total >= 0 && plan.Total == plan.Items.Sum(i => i.Amount);
        if (plan is not null && !planValid) blockers.Add("deposit_deduction_reapproval_required");
        if (planValid) blockers.Remove("final_charges_and_damage_policy_pending");
        var financialReference = plan is null ? obligationReference : "DEPOSIT-" + Convert.ToHexString(SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(new { obligationReference, plan.Id, plan.Version, plan.Total })));
        var position = positions is null ? null : await positions.ReadAsync(depositIds, t, financialReference);
        var deductions = (plan?.Total ?? 0) + maintenanceDeductions;
        var calculation = SettlementCalculator.Calculate(invoices, deposit, position, deductions);
        if (position is not null && !calculation.DepositPositionConsistent) blockers.Add("deposit_ledger_reconciliation_required");
        if (position?.UnclassifiedRefunds > 0) blockers.Add("deposit_refund_manual_review_required");
        var approvedOffsets = new List<DepositOffsetApproval>();
        foreach (var version in chain) approvedOffsets.AddRange(await SettlementChargeRecords.ReadAsync<DepositOffsetApproval>(db, version.Id, SettlementChargeRecords.OffsetKind, t));
        var offsetIds = approvedOffsets.Where(o => o.SourceDepositContractId == depositRoot.Id).Select(o => o.Id).ToArray();
        var canonicalOffsets = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a => a.SourceDepositContractId == depositRoot.Id && a.DepositOffsetApprovalId != null && offsetIds.Contains(a.DepositOffsetApprovalId.Value))
            .SumAsync(a => (decimal?)a.Amount, t) ?? 0 : 0;
        if (canonicalOffsets != approvedOffsets.Where(o => o.SourceDepositContractId == depositRoot.Id).Sum(o => o.Amount)) blockers.Add("deposit_offset_reconciliation_required");
        if (position is not null && position.Allocated != canonicalOffsets) blockers.Add("deposit_offset_reconciliation_required");
        var returned = deposit > 0 && position is { Reserved: 0, UnclassifiedRefunds: 0 } && position.Allocated == canonicalOffsets &&
            position.Refunded + deductions + canonicalOffsets == deposit && calculation.DepositPositionConsistent && (reviewedCharges || inspection?.NoAdditionalCharges == true || planValid);
        if (returned) blockers.Remove("deposit_deduction_refund_policy_required");
        var resolved = blockers.Count == 0;
        var value = new ContractSettlementSummary(id, depositRoot.Id, c.RoomId, c.Room.RoomNumber, c.TenantUserId ?? throw ContractException.Conflict("active_tenant_account_required"), deposit, holdingCredit,
            calculation.ContractSpecificOutstanding, planValid || maintenanceDeductions > 0 ? deductions : inspection?.NoAdditionalCharges == true ? 0 : null,
            planValid || maintenanceDeductions > 0 ? deductions : deposit == 0 || returned ? 0 : null,
            returned ? position!.Refunded : deposit == 0 && holdingCredit == 0 ? 0 : null,
            invoices, blockers.Distinct().Order().ToArray(), other, resolved, "",
            returned ? position!.Refunded > 0 ? "VerifiedManual" : "NotRequired" : deposit == 0 && holdingCredit == 0 ? "NotRequired" : "PendingReview",
            calculation, financialReference, plan, obligationReference, chargeBalances, reviewedCharges ? review : null, canonicalOffsets, maintenanceDeductions);
        if (charges.Length > 0) value = value with { ApprovedFinalCharges = charges.Sum(charge => charge.Amount) };
        // Snapshot identity includes sources and their revisions, no user supplied financial totals.
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { value, Root = root.Id, root.RequiredDeposit, deposits, Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges }, Readings = m is null ? null : new { m.ElectricityReadingId, m.WaterReadingId } })));
        return value with { Reference = "BH40-" + fingerprint };
    }
}

internal sealed record SettlementDepositReceipt(Guid Id, decimal Amount, DateTimeOffset VerifiedAt);
