using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Billing;

internal sealed class InvoiceFinancialRow
{
    public Guid Id { get; init; }
    public Guid LocationId { get; init; }
    public Guid RoomId { get; init; }
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
    public static IQueryable<InvoiceFinancialRow> Financials(this BHomeDbContext db, IQueryable<Invoice> invoices) => invoices.Select(i => new InvoiceFinancialRow
    {
        Id = i.Id,
        LocationId = i.LocationId,
        RoomId = i.RoomId,
        LocationName = i.LocationName,
        RoomNumber = i.RoomNumber,
        BillingPeriod = i.BillingPeriod,
        DueDate = i.DueDate,
        Original = i.Total,
        Adjustments = db.Set<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == i.Id && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved").Sum(d => (decimal?)d.Delta) ?? 0m,
        Paid = db.Set<PaymentAllocation>().Where(a => a.InvoiceId == i.Id).Sum(a => (decimal?)a.Amount) ?? 0m,
        Version = db.Set<InvoiceAdjustmentDecision>().Count(d => d.InvoiceId == i.Id && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved")
    });
    public static async Task<InvoiceFinancialView> FinancialsAsync(this BHomeDbContext db, Guid invoiceId, CancellationToken t) =>
        (await db.Financials(db.Set<Invoice>().AsNoTracking().Where(i => i.Id == invoiceId)).SingleAsync(t)).View();
}
