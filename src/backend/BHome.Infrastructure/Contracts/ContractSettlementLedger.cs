using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractSettlementLedger(BHomePersistenceContext db) : IContractSettlementLedger, IContractSettlementDetails
{
    public async Task<SettlementLedgerState?> ReadAsync(Guid id, Guid electricity, Guid water, CancellationToken t)
    {
        var m = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == id, t);
        var summary = await SummaryAsync(id, t);
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
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(t);
        HandoverSnapshot? observed = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        if (m?.ApprovedAt is null) blockers.Add("owner_termination_approval_required");
        if (inspection?.OwnerDecision != "Confirmed") blockers.Add("owner_confirmed_inspection_required");
        if (inspection?.NoAdditionalCharges != true) blockers.Add("final_charges_and_damage_policy_pending");
        if (inspection is null) blockers.Add("confirmed_handover_baseline_required");
        var end = observed?.Date ?? m?.ProposedDate ?? c.EndDate;
        var start = new DateOnly(root.StartDate.Year, root.StartDate.Month, 1); var through = new DateOnly(end.Year, end.Month, 1);
        if (through < start || through.Year - start.Year > 20) throw ContractException.Conflict("settlement_period_review_required");
        var deposits = await db.Set<DepositVerification>().AsNoTracking().Where(d => d.ContractId == root.Id).OrderBy(d => d.Id).Select(d => new { d.Id, d.Amount, d.VerifiedAt }).ToArrayAsync(t);
        var deposit = decimal.Truncate(deposits.Sum(d => d.Amount));
        if (deposit > 0 || chain.Any(c => c.RequiredDeposit > 0)) blockers.Add("deposit_deduction_refund_policy_required");
        if (root.HoldingContractId != null || root.AppliedHoldingDeposit > 0) blockers.Add("holding_allocation_settlement_required");
        var invoiceEntities = await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).Where(i => i.RoomId == c.RoomId && i.BillingPeriod >= start && i.BillingPeriod <= through).OrderBy(i => i.BillingPeriod).ToArrayAsync(t);
        if (invoiceEntities.Length > 250) throw ContractException.Conflict("settlement_period_review_required");
        var ids = invoiceEntities.Select(i => i.Id).ToArray();
        var allRecipients = await db.Set<InvoiceRecipient>().AsNoTracking().Where(r => ids.Contains(r.InvoiceId)).ToArrayAsync(t);
        var invoices = new List<SettlementInvoice>();
        foreach (var month in Enumerable.Range(0, (through.Year - start.Year) * 12 + through.Month - start.Month + 1).Select(n => start.AddMonths(n)))
            if (!invoiceEntities.Any(i => i.BillingPeriod == month && i.Status == InvoiceStatus.Final && allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId))) blockers.Add("final_invoice_coverage_required:" + month.ToString("yyyy-MM"));
        foreach (var invoice in invoiceEntities.Where(i => allRecipients.Any(r => r.InvoiceId == i.Id && r.TenantUserId == c.TenantUserId)))
        {
            if (invoice.Status != InvoiceStatus.Final) { blockers.Add("draft_invoice_pending"); continue; }
            var finances = await db.FinancialsAsync(invoice.Id, t); var shared = allRecipients.Count(r => r.InvoiceId == invoice.Id) > 1;
            invoices.Add(new(invoice.Id, invoice.BillingPeriod, shared, finances));
            if (finances.OutstandingAmount > 0) blockers.Add(shared ? "shared_liability_allocation_pending" : "invoice_outstanding");
            if (finances.PotentialExcessAmount > 0) blockers.Add("invoice_excess_pending_review");
        }
        if (await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => ids.Contains(r.InvoiceId) && r.Decision == null, t)) blockers.Add("invoice_adjustment_pending");
        if (await db.Set<PaymentReconciliation>().AnyAsync(r => r.InvoiceId != null && ids.Contains(r.InvoiceId.Value) && r.Decision == "PendingReview" &&
            !db.Set<PaymentReconciliation>().Any(n => n.TransferId == r.TransferId && n.Sequence > r.Sequence) && !db.Set<PaymentAllocation>().Any(a => a.TransferId == r.TransferId), t)) blockers.Add("bank_transfer_pending_review");
        if (observed is not null)
        {
            foreach (var final in new[] { observed.Electricity, observed.Water })
            {
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
        var resolved = blockers.Count == 0;
        var value = new ContractSettlementSummary(id, root.Id, c.RoomId, c.Room.RoomNumber, c.TenantUserId ?? throw ContractException.Conflict("active_tenant_account_required"), deposit, root.AppliedHoldingDeposit,
            resolved ? 0 : null, inspection?.NoAdditionalCharges == true ? 0 : null, deposit == 0 ? 0 : null, deposit == 0 && root.AppliedHoldingDeposit == 0 ? 0 : null,
            invoices, blockers.Distinct().Order().ToArray(), other, resolved, "", deposit == 0 && root.AppliedHoldingDeposit == 0 ? "NotRequired" : "PendingReview");
        // Snapshot identity includes sources and their revisions, no user supplied financial totals.
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { value, Root = root.Id, root.RequiredDeposit, deposits, Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges }, Readings = m is null ? null : new { m.ElectricityReadingId, m.WaterReadingId } })));
        return value with { Reference = "BH40-" + fingerprint };
    }
}
