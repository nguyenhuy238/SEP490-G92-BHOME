using System.Globalization;
using BHome.Application.Finance;
using BHome.Domain.Billing;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    // Aggregate each source by calendar month in the same read snapshot as the
    // totals. Query count is independent of the number of requested months.
    private async Task<IReadOnlyList<FinanceTrendPoint>> ReadTrendAsync(ReportFilter filter, DateOnly today, CancellationToken token)
    {
        var invoices = db.Financials(db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i =>
            i.Status == InvoiceStatus.Final && i.BillingPeriod >= filter.From && i.BillingPeriod <= filter.To &&
            (filter.LocationId == null || i.LocationId == filter.LocationId) &&
            (filter.RoomId == null || i.RoomId == filter.RoomId)));
        var invoiceAmounts = await invoices.GroupBy(i => new { i.BillingPeriod.Year, i.BillingPeriod.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Amount = g.Sum(i => i.Original + i.Adjustments) })
            .ToArrayAsync(token);
        // ReadCoreAsync has already validated settlement source integrity.
        var settlements = await SettlementSourceRows(filter).Where(r => r.BasisDate >= filter.From && r.BasisDate <= filter.To)
            .GroupBy(r => new { r.BasisDate.Year, r.BasisDate.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Amount = g.Sum(r => r.Amount) }).ToArrayAsync(token);
        var costs = await db.Database.SqlQuery<FinanceMonthAmount>($"""
            SELECT extract(year FROM occurred_on)::int AS "Year",extract(month FROM occurred_on)::int AS "Month",
              sum(amount) AS "Amount"
            FROM expenses WHERE expense_type='OPERATING' AND occurred_on BETWEEN {filter.From} AND {filter.To}
              AND ({filter.LocationId}::uuid IS NULL OR location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room_id={filter.RoomId})
            GROUP BY extract(year FROM occurred_on),extract(month FROM occurred_on)
            """).ToArrayAsync(token);
        var start = new DateTimeOffset(filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var end = new DateTimeOffset(filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var collections = await CashSourceRows(filter, start, end).Where(r => r.Kind != "Deposit")
            .GroupBy(r => new
            {
                Year = r.ReceivedAt!.Value.UtcDateTime.AddHours(7).Year,
                Month = r.ReceivedAt!.Value.UtcDateTime.AddHours(7).Month
            })
            .Select(g => new { g.Key.Year, g.Key.Month, Amount = g.Sum(r => r.Amount) }).ToArrayAsync(token);
        // Confirmed payments alone are shown here. A zero confirmed amount does
        // not assert that legacy expenses have complete payment history.
        var payments = await db.Database.SqlQuery<FinanceMonthAmount>($"""
            SELECT extract(year FROM (h->'state'->>'paidOn')::date)::int AS "Year",
              extract(month FROM (h->'state'->>'paidOn')::date)::int AS "Month",
              sum((h->'state'->>'amount')::numeric) AS "Amount"
            FROM expenses e CROSS JOIN LATERAL jsonb_array_elements(e.history) h
            WHERE e.expense_type='OPERATING' AND h->>'recordType'='ExpensePaymentV1'
              AND (h->'state'->>'paidOn')::date BETWEEN {filter.From} AND {filter.To}
              AND ({filter.LocationId}::uuid IS NULL OR e.location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR e.room_id={filter.RoomId})
            GROUP BY extract(year FROM (h->'state'->>'paidOn')::date),extract(month FROM (h->'state'->>'paidOn')::date)
            """).ToArrayAsync(token);
        var revenue = invoiceAmounts.Concat(settlements).GroupBy(r => (r.Year, r.Month))
            .ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
        var expenseAmounts = costs.ToDictionary(r => (r.Year, r.Month), r => r.Amount);
        var cashAmounts = collections.ToDictionary(r => (r.Year, r.Month), r => r.Amount);
        var paidAmounts = payments.ToDictionary(r => (r.Year, r.Month), r => r.Amount);
        static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
        var points = new List<FinanceTrendPoint>();
        for (var month = new DateOnly(filter.From.Year, filter.From.Month, 1); month <= filter.To; month = month.AddMonths(1))
        {
            var monthEnd = month.AddMonths(1).AddDays(-1);
            var from = filter.From > month ? filter.From : month;
            var to = filter.To < monthEnd ? filter.To : monthEnd;
            var key = (month.Year, month.Month);
            var issued = revenue.GetValueOrDefault(key);
            var operating = expenseAmounts.GetValueOrDefault(key);
            points.Add(new(from, to, Number(issued), Number(operating), Number(issued - operating),
                Number(cashAmounts.GetValueOrDefault(key)), Number(paidAmounts.GetValueOrDefault(key)),
                from == month && to == monthEnd && to < today));
        }
        return points;
    }
}

public sealed class FinanceMonthAmount
{
    public int Year { get; set; }
    public int Month { get; set; }
    public decimal Amount { get; set; }
}
