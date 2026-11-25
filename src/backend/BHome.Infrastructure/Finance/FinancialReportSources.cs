using System.Data;
using BHome.Application.Finance;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    public async Task<DepreciationSourcePage> DepreciationSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        await using var snapshot = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token) : null;
        var rooms = db.Set<Room>().AsNoTracking().Where(r =>
            (filter.RoomId == null || r.Id == filter.RoomId) &&
            (filter.LocationId == null || r.LocationId == filter.LocationId));
        if (filter.RoomId is not null && !await rooms.AnyAsync(token))
            throw new FinanceException(404, "finance_scope_not_found");
        var locations = await db.Set<Location>().AsNoTracking().Where(l =>
            (filter.LocationId == null || l.Id == filter.LocationId) &&
            (filter.RoomId == null || rooms.Any(r => r.LocationId == l.Id)))
            .Select(l => l.Id).ToArrayAsync(token);
        if (filter.LocationId is not null && locations.Length == 0)
            throw new FinanceException(404, "finance_scope_not_found");
        // Same asset completeness guard as the report, but no invoice, cash,
        // settlement, occupancy or unrelated expense queries for each page.
        var (pending, missing) = await ReadCapitalCompletenessAsync(filter, locations, token);
        var detail = await new DepreciationRepository(db).SourcesAsync(filter, page, pageSize, token);
        static string Number(decimal value) => value.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
        decimal? total = detail.Unknown == 0 && missing.Count == 0 && pending.Values.All(v => v == 0)
            ? detail.Known : null;
        if (snapshot is not null) await snapshot.CommitAsync(token);
        return new(detail.Items, detail.Total, page, pageSize, total is { } value ? Number(value) : null,
            Number(detail.Known), detail.Unknown, clock.GetUtcNow());
    }

    private async Task<(Dictionary<Guid, decimal> Pending, HashSet<Guid> Missing)> ReadCapitalCompletenessAsync(
        ReportFilter filter, IEnumerable<Guid> locations, CancellationToken token)
    {
        var pending = new Dictionary<Guid, decimal>();
        var missing = new HashSet<Guid>();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        foreach (var location in locations)
        {
            var assets = (await capitalAssets.ReadAsync(location, token)).Where(a => a.Verified &&
                (filter.RoomId is null || a.RoomId == filter.RoomId)).ToArray();
            if (assets.Any(a => a.MissingHistoricalPrice ||
                a.PurchaseCost is null && a.LegacyAmount is null && a.SnapshotAmount is null))
                missing.Add(location);
            pending[location] = assets.SelectMany(a => a.PendingEvents)
                .Where(p => (p.PurchaseDate ?? today) <= filter.To).Sum(p => p.Amount);
        }
        return (pending, missing);
    }
    public async Task<(IReadOnlyList<FinanceSourceRow> Items, long Total, decimal Amount)> SourcesAsync(
        ReportFilter filter, string kind, int page, int pageSize, CancellationToken token)
    {
        await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        if (filter.LocationId is { } location && !await db.Set<Location>().AnyAsync(l => l.Id == location, token) ||
            filter.RoomId is { } room && !await db.Set<Room>().AnyAsync(r => r.Id == room &&
                (filter.LocationId == null || r.LocationId == filter.LocationId), token))
            throw new FinanceException(404, "finance_scope_not_found");
        var start = new DateTimeOffset(filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var end = new DateTimeOffset(filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var skip = checked((page - 1) * pageSize);
        var items = new List<FinanceSourceRow>(pageSize);
        long total;
        decimal amount;
        if (kind is "cash" or "deposit")
        {
            _ = await SettlementSourcesAsync(filter, start, end, token);
            var query = CashSourceRows(filter, start, end);
            query = kind == "deposit" ? query.Where(r => r.Kind == "Deposit") : query.Where(r => r.Kind != "Deposit");
            total = await query.LongCountAsync(token);
            amount = await query.SumAsync(r => r.Amount, token);
            var rows = await query.OrderByDescending(r => r.ReceivedAt).ThenBy(r => r.Id).Skip(skip).Take(pageSize).ToArrayAsync(token);
            items.AddRange(rows.Select(r => r.View()));
        }
        else
        {
            // Same invoice financial projection and settlement integrity guard as the report.
            _ = await SettlementSourcesAsync(filter, start, end, token);
            var invoices = db.Financials(db.Set<Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final &&
                (filter.LocationId == null || i.LocationId == filter.LocationId) && (filter.RoomId == null || i.RoomId == filter.RoomId)));
            var settlement = SettlementSourceRows(filter);
            if (kind != "debt")
            {
                invoices = invoices.Where(i => i.BillingPeriod >= filter.From && i.BillingPeriod <= filter.To);
                settlement = settlement.Where(r => r.BasisDate >= filter.From && r.BasisDate <= filter.To);
            }
            if (kind != "revenue")
            {
                invoices = invoices.Where(i => Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid) > 0);
                settlement = settlement.Where(r => r.Amount - r.Allocated > 0);
            }
            var invoiceCount = await invoices.LongCountAsync(token);
            total = invoiceCount + await settlement.LongCountAsync(token);
            amount = kind == "revenue"
                ? await invoices.SumAsync(i => i.Original + i.Adjustments, token) + await settlement.SumAsync(r => r.Amount, token)
                : await invoices.SumAsync(i => Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid), token)
                    + await settlement.SumAsync(r => r.Amount - r.Allocated, token);
            if (skip < invoiceCount)
            {
                var rows = await invoices.OrderByDescending(i => i.BillingPeriod).ThenBy(i => i.Id).Skip(skip).Take(pageSize).ToArrayAsync(token);
                items.AddRange(rows.Select(i => new FinanceSourceRow(i.Id, "Invoice", i.LocationId, i.RoomId, i.RoomNumber,
                    i.ContractId, i.BillingPeriod, kind == "revenue" ? i.Original + i.Adjustments : Math.Max(0, Math.Max(0, i.Original + i.Adjustments) - i.Paid),
                    Original: i.Original, Adjustments: i.Adjustments, Allocated: i.Paid)));
            }
            if (items.Count < pageSize)
            {
                var rows = await settlement.OrderByDescending(r => r.BasisDate).ThenBy(r => r.Id)
                    .Skip((int)Math.Max(0, skip - invoiceCount)).Take(pageSize - items.Count).ToArrayAsync(token);
                items.AddRange(rows.Select(r => r.View() with { Amount = kind == "revenue" ? r.Amount : r.Amount - r.Allocated }));
            }
        }
        await snapshot.CommitAsync(token);
        return (items, total, amount);
    }

    private IQueryable<ReportSourceData> SettlementSourceRows(ReportFilter filter) => db.Database.SqlQuery<ReportSourceData>($"""
        SELECT (h->'state'->>'id')::uuid AS "Id", h->'state'->>'kind' AS "Kind",
          r.location_id AS "LocationId", r.id AS "RoomId", r.room_number AS "RoomNumber", c.id AS "ContractId",
          CASE h->'state'->>'kind' WHEN 'FinalUtility' THEN (h->'state'->'utility'->>'billingPeriod')::date
            WHEN 'FinalFixed' THEN (h->'state'->'fixedCharge'->>'billingPeriod')::date
            ELSE ((h->'state'->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END AS "BasisDate",
          (h->'state'->>'amount')::numeric AS "Amount", NULL::uuid AS "PaymentId", NULL::timestamptz AS "ReceivedAt",
          h->'state'->>'description' AS "Reference",
          COALESCE((SELECT sum(a.amount) FROM payment_allocations a WHERE a.target_settlement_contract_id=c.id
            AND a.settlement_receivable_id=(h->'state'->>'id')::uuid),0) AS "Allocated"
        FROM contracts c JOIN rooms r ON r.id=c.room_id CROSS JOIN LATERAL jsonb_array_elements(c.history) h
        WHERE h->>'recordType'='SettlementReceivableV1' AND COALESCE(h->'state'->>'isDevelopmentDemo','false')<>'true'
          AND ({filter.LocationId}::uuid IS NULL OR r.location_id={filter.LocationId})
          AND ({filter.RoomId}::uuid IS NULL OR r.id={filter.RoomId})
        """);

    private IQueryable<ReportSourceData> CashSourceRows(ReportFilter filter, DateTimeOffset start, DateTimeOffset end) =>
        db.Database.SqlQuery<ReportSourceData>($"""
        SELECT a.id AS "Id", 'Invoice' AS "Kind", i.location_id AS "LocationId", i.room_id AS "RoomId",
          r.room_number AS "RoomNumber", i.contract_id AS "ContractId", i.billing_period AS "BasisDate", a.amount AS "Amount",
          p.id AS "PaymentId", p.received_at AS "ReceivedAt", p.transaction_reference AS "Reference", a.amount AS "Allocated"
        FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
        JOIN invoices i ON i.id=a.target_invoice_id JOIN rooms r ON r.id=i.room_id
        WHERE p.status='VERIFIED' AND i.status=1
          AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
          AND p.received_at>={start} AND p.received_at<{end}
          AND ({filter.LocationId}::uuid IS NULL OR i.location_id={filter.LocationId})
          AND ({filter.RoomId}::uuid IS NULL OR i.room_id={filter.RoomId})
        UNION ALL
        SELECT a.id, CASE WHEN a.target_initial_contract_id IS NOT NULL THEN 'InitialRent' ELSE 'Deposit' END,
          r.location_id,r.id,r.room_number,c.id,c.start_date,a.amount,p.id,p.received_at,p.transaction_reference,a.amount
        FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
        JOIN contracts c ON c.id=COALESCE(a.target_initial_contract_id,a.target_deposit_contract_id) JOIN rooms r ON r.id=c.room_id
        WHERE p.status='VERIFIED' AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
          AND p.received_at>={start} AND p.received_at<{end}
          AND ({filter.LocationId}::uuid IS NULL OR r.location_id={filter.LocationId})
          AND ({filter.RoomId}::uuid IS NULL OR r.id={filter.RoomId})
        UNION ALL
        SELECT a.id,h->'state'->>'kind',r.location_id,r.id,r.room_number,c.id,
          CASE h->'state'->>'kind' WHEN 'FinalUtility' THEN (h->'state'->'utility'->>'billingPeriod')::date
            WHEN 'FinalFixed' THEN (h->'state'->'fixedCharge'->>'billingPeriod')::date
            ELSE ((h->'state'->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END,
          a.amount,p.id,p.received_at,p.transaction_reference,a.amount
        FROM contracts c JOIN rooms r ON r.id=c.room_id CROSS JOIN LATERAL jsonb_array_elements(c.history) h
        JOIN payment_allocations a ON a.target_settlement_contract_id=c.id AND a.settlement_receivable_id=(h->'state'->>'id')::uuid
        JOIN payments p ON p.id=a.source_payment_id
        WHERE h->>'recordType'='SettlementReceivableV1' AND COALESCE(h->'state'->>'isDevelopmentDemo','false')<>'true'
          AND p.status='VERIFIED' AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
          AND p.received_at>={start} AND p.received_at<{end}
          AND ({filter.LocationId}::uuid IS NULL OR r.location_id={filter.LocationId})
          AND ({filter.RoomId}::uuid IS NULL OR r.id={filter.RoomId})
        """);
}

public sealed class ReportSourceData
{
    public Guid Id { get; set; }
    public string Kind { get; set; } = "";
    public Guid LocationId { get; set; }
    public Guid RoomId { get; set; }
    public string RoomNumber { get; set; } = "";
    public Guid ContractId { get; set; }
    public DateOnly BasisDate { get; set; }
    public decimal Amount { get; set; }
    public Guid? PaymentId { get; set; }
    public DateTimeOffset? ReceivedAt { get; set; }
    public string? Reference { get; set; }
    public decimal Allocated { get; set; }
    public FinanceSourceRow View() => new(Id, Kind, LocationId, RoomId, RoomNumber, ContractId, BasisDate,
        Amount, PaymentId, ReceivedAt, Reference, Allocated: Allocated);
}
