using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed class InvoiceFinancialRow
{
    public Guid Id { get; init; }
    public Guid LocationId { get; init; }
    public Guid RoomId { get; init; }
    public Guid ContractId { get; init; }
    public string LocationName { get; init; } = "";
    public string RoomNumber { get; init; } = "";
    public DateOnly BillingPeriod { get; init; }
    public DateOnly DueDate { get; init; }
    public decimal Original { get; init; }
    public decimal Adjustments { get; init; }
    public decimal Paid { get; init; }
    public int Version { get; init; }
    public InvoiceFinancialView View()
    {
        var balance = AdjustmentRules.Balance(Original, Adjustments, Paid);
        return new(decimal.Truncate(Original), decimal.Truncate(Adjustments), balance.Payable, decimal.Truncate(Paid), balance.Outstanding, balance.Excess, Version,
            balance.Excess > 0 ? "PendingReview" : "None");
    }
}
internal static class InvoiceFinancialQueries
{
    // Decisions are immutable snapshots. Preserve the status at decision time
    // and the recorded delta, including historical rows and missing JSON defaults.
    internal static IQueryable<InvoiceDecisionFinanceRow> FinalApprovedDecisions(this BHomePersistenceContext db) =>
        db.Database.SqlQueryRaw<InvoiceDecisionFinanceRow>("""
            SELECT COALESCE((decision_snapshot->>'invoiceId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "InvoiceId",
                decision_snapshot->>'chargeCode' AS "ChargeCode",
                COALESCE((decision_snapshot->>'delta')::numeric,0) AS "Delta"
            FROM invoice_adjustments
            WHERE decision_snapshot IS NOT NULL
              AND COALESCE((decision_snapshot->>'invoiceStatus')::integer,0)=1
              AND decision_snapshot->>'outcome'='Approved'
            """);

    internal static IQueryable<InvoiceItemFinanceRow> FinancialItems(this BHomePersistenceContext db) =>
        db.Database.SqlQueryRaw<InvoiceItemFinanceRow>("""
            SELECT invoice_id AS "InvoiceId",charge_code AS "ChargeCode",amount AS "Amount",
                COALESCE((calculation_snapshot->'compactState'->>'category')::integer,0) AS "Category"
            FROM invoice_items
            """);

    public static IQueryable<InvoiceFinancialRow> Financials(this BHomePersistenceContext db, IQueryable<Invoice> invoices)
    {
        if (db is not Compact24DbContext || db is Compact24ArchiveContext) return LegacyFinancials(db, invoices);
        var decisions = db.FinalApprovedDecisions();
        var allocations = db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking();
        return invoices.AsNoTracking().Select(i => new InvoiceFinancialRow
        {
            Id = i.Id,
            LocationId = i.LocationId,
            RoomId = i.RoomId,
            ContractId = i.ContractId,
            LocationName = i.BillingSnapshot.GetProperty("compactState").GetProperty("locationName").GetString() ?? "",
            RoomNumber = i.BillingSnapshot.GetProperty("compactState").GetProperty("roomNumber").GetString() ?? "",
            BillingPeriod = i.BillingPeriod,
            DueDate = i.DueDate,
            Original = i.BaseTotalAmount,
            Adjustments = decisions.Where(d => d.InvoiceId == i.Id).Sum(d => (decimal?)d.Delta) ?? 0m,
            Paid = allocations.Where(a => a.TargetInvoiceId == i.Id).Sum(a => (decimal?)a.Amount) ?? 0m,
            Version = decisions.Count(d => d.InvoiceId == i.Id)
        });
    }

    private static IQueryable<InvoiceFinancialRow> LegacyFinancials(BHomePersistenceContext db, IQueryable<Invoice> invoices) => invoices.Select(i => new InvoiceFinancialRow
    {
        Id = i.Id,
        LocationId = i.LocationId,
        RoomId = i.RoomId,
        ContractId = i.RepresentativeContractId,
        LocationName = i.LocationName,
        RoomNumber = i.RoomNumber,
        BillingPeriod = i.BillingPeriod,
        DueDate = i.DueDate,
        Original = i.Total,
        Adjustments = db.Set<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == i.Id && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved").Sum(d => (decimal?)d.Delta) ?? 0m,
        Paid = db.Set<PaymentAllocation>().Where(a => a.InvoiceId == i.Id).Sum(a => (decimal?)a.Amount) ?? 0m,
        Version = db.Set<InvoiceAdjustmentDecision>().Count(d => d.InvoiceId == i.Id && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved")
    });
    public static async Task<InvoiceFinancialView> FinancialsAsync(this BHomePersistenceContext db, Guid invoiceId, CancellationToken t) =>
        (await (db is Compact24DbContext
            ? db.Financials(db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == invoiceId))
            : LegacyFinancials(db, db.Set<Invoice>().AsNoTracking().Where(i => i.Id == invoiceId))).SingleAsync(t)).View();
}

internal sealed class InvoiceDecisionFinanceRow
{
    public Guid InvoiceId { get; set; }
    public string? ChargeCode { get; set; }
    public decimal Delta { get; set; }
}

internal sealed class InvoiceItemFinanceRow
{
    public Guid InvoiceId { get; set; }
    public string ChargeCode { get; set; } = "";
    public decimal Amount { get; set; }
    public int Category { get; set; }
}
