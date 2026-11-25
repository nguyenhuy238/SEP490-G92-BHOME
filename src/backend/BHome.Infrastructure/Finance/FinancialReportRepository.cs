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
    ICapitalAssetRepository capitalAssets, TimeProvider clock) : IFinancialReportRepository
{
    public async Task<ReportBasis> ReadAsync(ReportFilter filter, CancellationToken token)
    {
        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token) : null;
        var basis = await ReadCoreAsync(filter, token);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        var months = (filter.To.Year - filter.From.Year) * 12 + filter.To.Month - filter.From.Month + 1;
        basis = months > 120
            ? basis with { TrendUnavailableReason = "period_too_long" }
            : basis with { Trend = await ReadTrendAsync(filter, today, token) };
        if (filter.IncludeComparison && FinanceComparisonMath.Periods(filter, today) is { } periods)
        {
            var current = periods.Current.To == filter.To ? basis : await ReadCoreAsync(periods.Current, token);
            var previous = await ReadCoreAsync(periods.Previous, token);
            basis = basis with { Comparison = FinanceComparisonMath.Calculate(periods.Current, periods.Previous, current.Locations, previous.Locations) };
        }
        if (transaction is not null) await transaction.CommitAsync(token);
        return basis;
    }

    private async Task<ReportBasis> ReadCoreAsync(ReportFilter filter, CancellationToken token)
    {
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
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        var allInvoices = db.Set<Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final);
        if (filter.LocationId is { } debtLocation) allInvoices = allInvoices.Where(i => i.LocationId == debtLocation);
        if (filter.RoomId is { } debtRoom) allInvoices = allInvoices.Where(i => i.RoomId == debtRoom);
        var debt = await db.Financials(allInvoices).GroupBy(i => i.LocationId).Select(g => new
        {
            Id = g.Key,
            Outstanding = g.Sum(i => Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid)),
            Overdue = g.Sum(i => i.DueDate < today ? Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid) : 0)
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
        // A physical investment becomes visible as soon as the Owner confirms
        // inventory and records a price. The daily snapshot job will persist
        // exactly one source-managed expense for this asset. Exclude already
        // snapshotted or manually linked amounts to avoid double-counting.
        var (pendingAssetInvestments, missingAssetPrices) = await ReadCapitalCompletenessAsync(filter, names.Select(l => l.Id), token);
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
        var bankReceipts = await ReadBankReceiptBasisAsync(filter, start, end, token);
        var payments = await ReadExpensePaymentsAsync(filter, token);
        var rentRows = await db.Database.SqlQuery<ActiveRentRow>($"""
            WITH room_rates AS (
              SELECT r.id,r.location_id,min(c.monthly_rent) rent,
                bool_and(c.monthly_rent IS NOT NULL AND c.monthly_rent>0)
                  AND min(c.monthly_rent)=max(c.monthly_rent) valid
              FROM rooms r JOIN contracts c ON c.room_id=r.id
              WHERE c.contract_type='MAIN' AND c.status=3 AND c.activated_at IS NOT NULL
                AND c.start_date<={today} AND COALESCE(c.actual_end_date,c.end_date)>={today}
                AND ({filter.LocationId}::uuid IS NULL OR r.location_id={filter.LocationId})
                AND ({filter.RoomId}::uuid IS NULL OR r.id={filter.RoomId})
              GROUP BY r.id,r.location_id
            )
            SELECT location_id AS "LocationId", CASE WHEN bool_and(valid) THEN sum(rent) END AS "Rent",
              count(*)::int AS "Rooms" FROM room_rates GROUP BY location_id
            """).ToDictionaryAsync(r => r.LocationId, token);
        var depreciation = await new DepreciationRepository(db).AggregateAsync(filter, token);
        var disposalReceipts = await db.Database.SqlQuery<DisposalReceiptAggregate>($"""
            SELECT e.location_id AS "LocationId",
              COALESCE(sum((h->'state'->'input'->>'amount')::numeric) FILTER(WHERE (h->'state'->'input'->>'receivedOn')::date >= {filter.From}),0) AS "Period",
              COALESCE(sum((h->'state'->'input'->>'amount')::numeric),0) AS "Cumulative"
            FROM expenses e CROSS JOIN LATERAL jsonb_array_elements(e.history) h
            WHERE e.expense_type='INITIAL_INVESTMENT' AND h->>'recordType'='InvestmentDisposalReceiptV1'
              AND (h->'state'->'input'->>'receivedOn')::date <= {filter.To}
              AND ({filter.LocationId}::uuid IS NULL OR e.location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR e.room_id={filter.RoomId})
            GROUP BY e.location_id
            """).ToDictionaryAsync(r => r.LocationId, token);
        var categoryRows = await db.Database.SqlQuery<ReportExpenseCategoryRow>($"""
            SELECT location_id AS "LocationId", category AS "Category",sum(amount) AS "Amount"
            FROM expenses WHERE expense_type='OPERATING' AND occurred_on BETWEEN {filter.From} AND {filter.To}
              AND ({filter.LocationId}::uuid IS NULL OR location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room_id={filter.RoomId})
            GROUP BY location_id,category
            """).ToArrayAsync(token);
        var categories = categoryRows.GroupBy(c => c.LocationId).ToDictionary(g => g.Key,
            g => (IReadOnlyDictionary<string, decimal>)g.ToDictionary(c => c.Category, c => c.Amount, StringComparer.Ordinal));
        var result = names.Select(l =>
        {
            issued.TryGetValue(l.Id, out var i); expense.TryGetValue(l.Id, out var e); collected.TryGetValue(l.Id, out var c); counts.TryGetValue(l.Id, out var r);
            settlements.TryGetValue(l.Id, out var s);
            debt.TryGetValue(l.Id, out var d); bankReceipts.TryGetValue(l.Id, out var bank);
            payments.TryGetValue(l.Id, out var paid);
            rentRows.TryGetValue(l.Id, out var rent);
            var management = new FinanceManagementBasis(
                (bank?.BusinessCollected ?? 0) + (s?.ActualCollections ?? 0),
                (d?.Outstanding ?? 0) + (s?.AllDebt ?? 0), d?.Overdue ?? 0,
                (bank?.PriorCollections ?? 0) + (s?.PriorCollections ?? 0), bank?.DepositReceipts ?? 0,
                bank?.InitialRentAndFees ?? 0, (bank?.AdvanceCollections ?? 0) + (s?.AdvanceCollections ?? 0),
                (bank?.PeriodVerifiedCollections ?? 0) + (s?.PeriodVerifiedCollections ?? 0),
                OperatingPaymentsConfirmed: paid?.OperatingPaid ?? 0,
                OperatingUnpaidConfirmed: paid?.OperatingUnpaid ?? 0,
                OperatingUnknownPaymentAmount: paid?.OperatingUnknown ?? 0,
                OperatingPaymentHistoryComplete: (paid?.OperatingUnknownCumulative ?? 0) == 0,
                Depreciation: pendingAssetInvestments[l.Id] == 0 && !missingAssetPrices.Contains(l.Id)
                    ? depreciation.GetValueOrDefault(l.Id, 0) : null,
                InvestmentPaymentsConfirmed: paid?.InvestmentPaid ?? 0,
                InvestmentPaymentHistoryComplete: (paid?.InvestmentUnknown ?? 0) == 0 && pendingAssetInvestments[l.Id] == 0 && !missingAssetPrices.Contains(l.Id),
                ExpenseCategories: categories.GetValueOrDefault(l.Id),
                InvestmentInPeriod: paid?.InvestmentInPeriod ?? 0,
                CumulativeBusinessCollections: (bank?.CumulativeBusinessCollected ?? 0) + (s?.CumulativeActualCollections ?? 0),
                CumulativeOperatingPayments: paid?.OperatingPaidCumulative ?? 0,
                ActiveMonthlyRent: rent is null ? 0 : rent.Rent, ActiveRentRooms: rent?.Rooms ?? 0,
                AssetDisposalReceipts: disposalReceipts.GetValueOrDefault(l.Id)?.Period ?? 0,
                CumulativeAssetDisposalReceipts: disposalReceipts.GetValueOrDefault(l.Id)?.Cumulative ?? 0,
                InvestmentBasisComplete: !missingAssetPrices.Contains(l.Id));
            return new FinanceBasis(l.Id, l.Name, (i?.Issued ?? 0) + (s?.Charges ?? 0), i?.Adjustments ?? 0, (c?.Collected ?? 0) + (s?.Collections ?? 0), e?.Operating ?? 0, (i?.Debt ?? 0) + (s?.Debt ?? 0),
                (e?.Investment ?? 0) + pendingAssetInvestments[l.Id], (c?.CumulativeCollected ?? 0) + (s?.CumulativeCollections ?? 0), e?.CumulativeOperating ?? 0, r?.Total ?? 0, r?.Occupied ?? 0,
                s?.Charges ?? 0, s?.Debt ?? 0, s?.Collections ?? 0, s?.DepositOffsets ?? 0, s?.HoldingForfeitures ?? 0, management);
        }).ToArray();
        var historical = await HistoricalAsync(filter, token);
        ReceiptReconciliation? reconciliation = null;
        if (filter.LocationId is null && filter.RoomId is null)
        {
            var receipts = await ReadReceiptTotalsAsync(BankReceiptRows(start, end), token);
            string Money(decimal value) => value.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
            reconciliation = new(Money(receipts.Received), Money(receipts.Unallocated), Money(refunds.ExcessReturned));
        }
        return new(result, refunds.HasUnclassified, historical, refunds.DepositReturned, ReceiptReconciliation: reconciliation);
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
public sealed class ActiveRentRow
{
    public Guid LocationId { get; set; }
    public decimal? Rent { get; set; }
    public int Rooms { get; set; }
}
public sealed class DisposalReceiptAggregate
{
    public Guid LocationId { get; set; }
    public decimal Period { get; set; }
    public decimal Cumulative { get; set; }
}
