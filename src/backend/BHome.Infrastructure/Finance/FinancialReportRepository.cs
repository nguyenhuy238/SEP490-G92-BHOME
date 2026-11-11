using System.Data;
using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository(BHomePersistenceContext db, IRoomInsightsRepository insights,
    TimeProvider clock) : IFinancialReportRepository
{
    public async Task<ReportBasis> ReadAsync(ReportFilter filter, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        var rooms = db.Set<Room>().AsNoTracking().AsQueryable();
        if (filter.LocationId is { } location) rooms = rooms.Where(r => r.LocationId == location);
        if (filter.RoomId is { } room) rooms = rooms.Where(r => r.Id == room);
        if (filter.RoomId is not null && !await rooms.AnyAsync(token)) throw new FinanceException(404, "finance_scope_not_found");
        var locations = db.Set<Location>().AsNoTracking().AsQueryable();
        if (filter.LocationId is { } locationId) locations = locations.Where(l => l.Id == locationId);
        if (filter.RoomId is not null) locations = locations.Where(l => rooms.Any(r => r.LocationId == l.Id));
        var names = await locations.Select(l => new { l.Id, l.Name }).ToArrayAsync(token);
        if (filter.LocationId is not null && names.Length == 0) throw new FinanceException(404, "finance_scope_not_found");
        var counts = await rooms.GroupBy(r => r.LocationId).Select(g => new { Id = g.Key, Total = g.Count(), Occupied = g.Count(r => r.Status == RoomStatus.Occupied) }).ToDictionaryAsync(r => r.Id, token);
        var invoices = db.Set<Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final && i.BillingPeriod >= filter.From && i.BillingPeriod <= filter.To);
        if (filter.LocationId is { } invoiceLocation) invoices = invoices.Where(i => i.LocationId == invoiceLocation);
        if (filter.RoomId is { } invoiceRoom) invoices = invoices.Where(i => i.RoomId == invoiceRoom);
        var issued = await db.Financials(invoices).GroupBy(i => i.LocationId).Select(g => new
        {
            Id = g.Key,
            Issued = g.Sum(i => i.Original),
            Adjustments = g.Sum(i => i.Adjustments),
            Debt = g.Sum(i => Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid))
        }).ToDictionaryAsync(i => i.Id, token);
        var start = new DateTimeOffset(filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var end = new DateTimeOffset(filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var expense = await db.Database.SqlQuery<ExpenseAggregate>($"""
            SELECT location_id AS "LocationId",
              COALESCE(sum(amount) FILTER(WHERE expense_type='INITIAL_INVESTMENT'),0) AS "Investment",
              COALESCE(sum(amount) FILTER(WHERE expense_type='OPERATING'),0) AS "CumulativeOperating",
              COALESCE(sum(amount) FILTER(WHERE expense_type='OPERATING' AND occurred_on>={filter.From}),0) AS "Operating"
            FROM expenses WHERE occurred_on<={filter.To}
              AND ({filter.LocationId}::uuid IS NULL OR location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room_id={filter.RoomId}) GROUP BY location_id
            """).ToDictionaryAsync(e => e.LocationId, token);
        var collected = await db.Database.SqlQuery<CollectionAggregate>($"""
            SELECT i.location_id AS "LocationId",COALESCE(sum(a.amount),0) AS "CumulativeCollected",
              COALESCE(sum(a.amount) FILTER(WHERE a.allocated_at>={start}),0) AS "Collected"
            FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id JOIN invoices i ON i.id=a.target_invoice_id
            WHERE p.status='VERIFIED' AND i.status=1 AND a.allocated_at<{end}
              AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
              AND ({filter.LocationId}::uuid IS NULL OR i.location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR i.room_id={filter.RoomId}) GROUP BY i.location_id
            """).ToDictionaryAsync(c => c.LocationId, token);
        var refunds = await RefundAccountingAsync(filter, start, end, token);
        var settlements = await SettlementSourcesAsync(filter, start, end, token);
        var result = names.Select(l =>
        {
            issued.TryGetValue(l.Id, out var i); expense.TryGetValue(l.Id, out var e); collected.TryGetValue(l.Id, out var c); counts.TryGetValue(l.Id, out var r);
            settlements.TryGetValue(l.Id, out var s);
            return new FinanceBasis(l.Id, l.Name, (i?.Issued ?? 0) + (s?.Charges ?? 0), i?.Adjustments ?? 0, (c?.Collected ?? 0) + (s?.Collections ?? 0), e?.Operating ?? 0, (i?.Debt ?? 0) + (s?.Debt ?? 0),
                e?.Investment ?? 0, (c?.CumulativeCollected ?? 0) + (s?.CumulativeCollections ?? 0), e?.CumulativeOperating ?? 0, r?.Total ?? 0, r?.Occupied ?? 0,
                s?.Charges ?? 0, s?.Debt ?? 0, s?.Collections ?? 0, s?.DepositOffsets ?? 0, s?.HoldingForfeitures ?? 0);
        }).ToArray();
        var historical = await HistoricalAsync(filter, token);
        await transaction.CommitAsync(token); return new(result, refunds.HasUnclassified, historical, refunds.DepositReturned);
    }

    private async Task<HistoricalOccupancy> HistoricalAsync(ReportFilter filter, CancellationToken token)
    {
        HistoricalOccupancy Unavailable(string status, string reason) =>
            new(status, filter.From, filter.To, null, null, null, [reason]);
        if (filter.RoomId is not null)
            return Unavailable("RoomFilterUnsupported", "Historical occupancy requires a Location without a Room filter.");
        if (filter.LocationId is not { } locationId)
            return Unavailable("LocationRequired", "Select one Location to calculate historical occupancy.");
        // Reuse the existing Property insight boundary and its supported period limit.
        // A financial report may cover a longer/future period; keep its existing figures available.
        if (filter.To.DayNumber - filter.From.DayNumber > 366)
            return Unavailable("PeriodUnsupported", "Historical occupancy supports a date difference of at most 366 days.");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        if (filter.To > today)
            return Unavailable("FuturePeriod", "Future dates cannot be reported as historical occupancy.");
        // The injected insight repository shares this DbContext/RepeatableRead transaction.
        var model = await insights.OccupancyAsync(locationId, today, filter.From, filter.To, token);
        return model.CompleteAvailabilityEvidence
            ? PropertyService.CalculateHistorical(filter.From, filter.To, locationId, model)
            : Unavailable("InsufficientData", "Complete Location/Room availability audit is not available for the requested period.");
    }
}
public sealed class ExpenseAggregate
{
    public Guid LocationId { get; set; }
    public decimal Investment { get; set; }
    public decimal CumulativeOperating { get; set; }
    public decimal Operating { get; set; }
}
public sealed class CollectionAggregate
{
    public Guid LocationId { get; set; }
    public decimal Collected { get; set; }
    public decimal CumulativeCollected { get; set; }
}
