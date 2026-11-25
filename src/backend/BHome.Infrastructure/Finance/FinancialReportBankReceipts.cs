using System.Data;
using System.Globalization;
using BHome.Application.Finance;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    private static async Task<(decimal Received, decimal Unallocated)> ReadReceiptTotalsAsync(
        IQueryable<BankReceiptData> query, CancellationToken token)
    {
        var totals = await query.GroupBy(r => 1).Select(g => new
        {
            Received = g.Sum(r => r.Amount),
            Unallocated = g.Sum(r => r.GrossUnallocated)
        }).SingleOrDefaultAsync(token);
        return (totals?.Received ?? 0, totals?.Unallocated ?? 0);
    }

    private IQueryable<BankReceiptData> BankReceiptRows(DateTimeOffset start, DateTimeOffset end) =>
        db.Database.SqlQuery<BankReceiptData>($"""
            SELECT p.id AS "Id", p.received_at AS "ReceivedAt", p.transaction_reference AS "Reference",
              p.amount AS "Amount", COALESCE(a.allocated,0) AS "Allocated",
              p.amount-COALESCE(a.allocated,0) AS "GrossUnallocated"
            FROM payments p LEFT JOIN LATERAL (
              SELECT sum(amount) allocated FROM payment_allocations WHERE source_payment_id=p.id
            ) a ON true
            WHERE p.status='VERIFIED' AND p.received_at>={start} AND p.received_at<{end}
              AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
            """);

    public async Task<BankReceiptSourcePage> BankReceiptSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, token);
        var start = new DateTimeOffset(filter.From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var end = new DateTimeOffset(filter.To.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var query = BankReceiptRows(start, end);
        var count = await query.LongCountAsync(token);
        var (received, unallocated) = await ReadReceiptTotalsAsync(query, token);
        var rows = await query.OrderByDescending(r => r.ReceivedAt).ThenBy(r => r.Id)
            .Skip(checked((page - 1) * pageSize)).Take(pageSize).ToArrayAsync(token);
        await snapshot.CommitAsync(token);
        static string Money(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
        return new(rows.Select(r => new BankReceiptSource(r.Id, r.ReceivedAt, r.Reference,
            Money(r.Amount), Money(r.Allocated), Money(r.GrossUnallocated))).ToArray(),
            count, page, pageSize, Money(received), Money(unallocated), clock.GetUtcNow());
    }
}

public sealed class BankReceiptData
{
    public Guid Id { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public string Reference { get; set; } = "";
    public decimal Amount { get; set; }
    public decimal Allocated { get; set; }
    public decimal GrossUnallocated { get; set; }
}
