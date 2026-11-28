using System.Text.Json;
using BHome.Application.Finance;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class DepreciationRepository(BHomePersistenceContext db) : IDepreciationRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Columns = """
        SELECT id AS "ExpenseId", location_id AS "LocationId", room_id AS "RoomId", asset_id AS "AssetId",
          COALESCE(NULLIF(note,''),category) AS "Name", amount AS "Cost", occurred_on AS "PurchasedOn",
          CASE WHEN source_key LIKE 'asset-capital:%' AND (history->0->>'quantity') ~ '^[0-9]+$'
            THEN (history->0->>'quantity')::int ELSE NULL END AS "Quantity",
          jsonb_array_length(history) AS "Version",
          COALESCE((SELECT jsonb_agg(h->'state' ORDER BY n) FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
            WHERE h->>'recordType'='DepreciationPlanV1'),'[]'::jsonb)::text AS "Revisions",
          (SELECT h->'state' FROM jsonb_array_elements(history) h WHERE h->>'recordType'='InvestmentDisposalV1')::text AS "Disposal",
          COALESCE((SELECT jsonb_agg(h->'state' ORDER BY n) FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
            WHERE h->>'recordType'='InvestmentPartialDisposalV1'),'[]'::jsonb)::text AS "PartialDisposals",
          COALESCE((SELECT jsonb_agg(h->'state' ORDER BY n) FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
            WHERE h->>'recordType'='InvestmentDisposalReceiptV1'),'[]'::jsonb)::text AS "Receipts"
        FROM expenses WHERE expense_type='INITIAL_INVESTMENT'
        """;
    private IQueryable<DepreciationRow> Rows => db.Database.SqlQueryRaw<DepreciationRow>(Columns);
    internal static DepreciationLot Map(DepreciationRow row) => new(row.ExpenseId, row.LocationId, row.RoomId, row.AssetId,
        row.Name, row.Cost, row.Quantity, row.PurchasedOn, row.Version,
        JsonSerializer.Deserialize<DepreciationRevision[]>(row.Revisions, Json) ?? [],
        row.Disposal is null ? null : JsonSerializer.Deserialize<InvestmentDisposal>(row.Disposal, Json),
        JsonSerializer.Deserialize<InvestmentReceipt[]>(row.Receipts, Json) ?? [],
        JsonSerializer.Deserialize<InvestmentDisposal[]>(row.PartialDisposals, Json) ?? []);

    public async Task<DepreciationLot?> ReadAsync(Guid id, CancellationToken token) =>
        await Rows.SingleOrDefaultAsync(r => r.ExpenseId == id, token) is { } row ? Map(row) : null;

    public async Task<AssetRepairEvidence> RepairsAsync(DepreciationLot lot, DateTimeOffset through, CancellationToken token)
    {
        // BF-07 identifies the asset group, not the individual purchase lot. Never
        // allocate this cost to multiple lots or feed it back into the expense ledger.
        var start = new DateTimeOffset(lot.PurchasedOn.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        if (lot.Disposal is { } disposal)
        {
            var end = new DateTimeOffset(disposal.Input.DisposedOn.ToDateTime(TimeOnly.MaxValue), TimeSpan.FromHours(7)).ToUniversalTime();
            if (end < through) through = end;
        }
        var rows = db.Set<MaintenanceHistory>().AsNoTracking().Where(h => h.AssetId == lot.AssetId &&
            h.LocationId == lot.LocationId && h.VerifiedAt >= start && h.VerifiedAt <= through);
        var result = await rows.GroupBy(_ => 1).Select(g => new
        {
            Count = g.Select(h => h.ActivityId).Distinct().Count(),
            Latest = g.Max(h => h.VerifiedAt)
        }).SingleOrDefaultAsync(token);
        // Only official accepted BF-07 expense records contribute money.
        // Zero-cost verification remains visible in the count, not in the ledger.
        var cost = await db.Set<MaintenanceExpense>().AsNoTracking()
            .Where(e => e.AssetId == lot.AssetId && e.LocationId == lot.LocationId &&
                e.SourceId != Guid.Empty && e.ConfirmedAt >= start && e.ConfirmedAt <= through)
            .SumAsync(e => e.Amount, token);
        return new(result?.Count ?? 0, cost, result?.Latest);
    }

    public async Task<(IReadOnlyList<DepreciationLot> Lots, long Total)> ListAsync(Guid? locationId, int page, int pageSize, CancellationToken token)
    {
        var rows = Rows.Where(r => locationId == null || r.LocationId == locationId);
        var total = await rows.LongCountAsync(token);
        var items = await rows.OrderByDescending(r => r.PurchasedOn).ThenBy(r => r.ExpenseId)
            .Skip(checked((page - 1) * pageSize)).Take(pageSize).ToArrayAsync(token);
        return (items.Select(Map).ToArray(), total);
    }

    internal async Task<Dictionary<Guid, decimal?>> AggregateAsync(ReportFilter filter, CancellationToken token)
    {
        var rows = Rows.Where(r => r.PurchasedOn <= filter.To &&
            (filter.LocationId == null || r.LocationId == filter.LocationId) &&
            (filter.RoomId == null || r.RoomId == filter.RoomId));
        var totals = new Dictionary<Guid, decimal?>();
        // Keep only the aggregate while reading purchase-lot revision histories.
        // A missing plan makes its Location unknown even if later lots are known.
        await foreach (var row in rows.AsAsyncEnumerable().WithCancellation(token))
        {
            var amount = DepreciationMath.Calculate(Map(row), filter.From, filter.To)?.Period;
            totals[row.LocationId] = totals.TryGetValue(row.LocationId, out var previous)
                ? previous + amount : amount;
        }
        return totals;
    }
    internal async Task<(DepreciationSource[] Items, long Total, decimal Known, int Unknown)> SourcesAsync(
        ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        var query = Rows.Where(r => r.PurchasedOn <= filter.To &&
            (filter.LocationId == null || r.LocationId == filter.LocationId) &&
            (filter.RoomId == null || r.RoomId == filter.RoomId))
            .OrderByDescending(r => r.PurchasedOn).ThenBy(r => r.ExpenseId);
        var items = new List<DepreciationSource>(pageSize);
        var skip = (long)(page - 1) * pageSize;
        long count = 0;
        decimal known = 0;
        var unknown = 0;
        // Stream the revision histories once, using the same decimal formula as the
        // report. Only the requested page is retained; no N+1 lookup per asset lot.
        await foreach (var row in query.AsAsyncEnumerable().WithCancellation(token))
        {
            var lot = Map(row);
            var amounts = DepreciationMath.Calculate(lot, filter.From, filter.To);
            if (amounts is null) unknown++; else known += amounts.Period;
            if (count >= skip && items.Count < pageSize)
                items.Add(new(lot.ExpenseId, lot.LocationId, lot.RoomId, lot.AssetId, lot.Name,
                    lot.Cost.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture),
                    lot.Quantity, lot.PurchasedOn, amounts, DepreciationMath.QuantityAt(lot, filter.To)));
            count++;
        }
        return (items.ToArray(), count, known, unknown);
    }

    public async Task<DepreciationLot> RecordAsync(Guid id, DepreciationInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var lot = await ReadAsync(id, token) ?? throw new FinanceException(404, "investment_not_found");
        if (lot.Revisions.SingleOrDefault(r => r.Key == key) is { } replay)
        {
            if (replay.ActorId != actor || replay.Plan != input) throw new FinanceException(409, "expense_idempotency_conflict");
            await transaction.CommitAsync(token);
            return lot;
        }
        if (lot.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var effective = DepreciationMath.Validate(lot, input, today);
        var revision = new DepreciationRevision(key, actor, now, input, effective);
        var history = JsonSerializer.Serialize(new[] { new { schemaVersion = 1, recordType = "DepreciationPlanV1", state = revision } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET history=history||{history}::jsonb WHERE id={id}", token);
        var result = (await ReadAsync(id, token))!;
        await transaction.CommitAsync(token);
        return result;
    }

    public async Task<DepreciationLot> DisposeAsync(Guid id, InvestmentDisposalInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var lot = await ReadAsync(id, token) ?? throw new FinanceException(404, "investment_not_found");
        if (lot.PartialDisposals?.SingleOrDefault(s => s.Key == key) is { } partialReplay)
        {
            if (partialReplay.ActorId != actor || partialReplay.Input != input)
                throw new FinanceException(409, "expense_idempotency_conflict");
            await transaction.CommitAsync(token);
            return lot;
        }
        if (lot.Disposal is { } previous)
        {
            if (previous.Key != key || previous.ActorId != actor || previous.Input != input)
                throw new FinanceException(409, "investment_already_disposed");
            await transaction.CommitAsync(token);
            return lot;
        }
        if (lot.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        if (input.DisposedOn < lot.PurchasedOn || lot.Revisions.Count == 0 ||
            input.DisposedOn < lot.Revisions[0].Plan.InServiceOn)
            throw new FinanceException(400, "invalid_investment_disposal");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        // Keep actual event date as evidence. A late declaration can only affect
        // depreciation from the current open month, with explicit confirmation.
        var openMonth = DepreciationMath.StartMonth(today);
        if (input.DisposedOn < openMonth && !input.RecognizeInOpenPeriod)
            throw new FinanceException(409, "investment_disposal_closed_period");
        var recognizedOn = input.DisposedOn < openMonth ? openMonth : input.DisposedOn;
        if (lot.PartialDisposals?.Any(s => s.Input.DisposedOn > input.DisposedOn || s.EffectiveOn > recognizedOn) == true)
            throw new FinanceException(409, "investment_disposal_date_out_of_order");
        if (input.Quantity is { } count && (lot.RemainingQuantity is not { } remaining || count <= 0 || count > remaining))
            throw new FinanceException(400, "invalid_investment_quantity");
        var partial = input.Quantity is { } units && units < lot.RemainingQuantity;
        await AppendAsync(id, partial ? "InvestmentPartialDisposalV1" : "InvestmentDisposalV1",
            new InvestmentDisposal(key, actor, now, input, recognizedOn), token);
        var result = (await ReadAsync(id, token))!;
        await transaction.CommitAsync(token);
        return result;
    }

    public async Task<DepreciationLot> ReceiveAsync(Guid id, InvestmentReceiptInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var lot = await ReadAsync(id, token) ?? throw new FinanceException(404, "investment_not_found");
        if (lot.Receipts?.SingleOrDefault(r => r.Key == key) is { } previous)
        {
            if (previous.ActorId != actor || previous.Input != input) throw new FinanceException(409, "expense_idempotency_conflict");
            await transaction.CommitAsync(token);
            return lot;
        }
        if (lot.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        var disposal = input.DisposalKey is { } saleKey
            ? lot.PartialDisposals?.SingleOrDefault(s => s.Key == saleKey)
            : lot.Disposal;
        if (disposal is null || input.ReceivedOn < disposal.Input.DisposedOn ||
            input.Amount > disposal.Input.SaleAmount - (lot.Receipts?.Where(r => r.Input.DisposalKey == input.DisposalKey).Sum(r => r.Input.Amount) ?? 0))
            throw new FinanceException(409, "investment_receipt_exceeds_balance");
        await AppendAsync(id, "InvestmentDisposalReceiptV1", new InvestmentReceipt(key, actor, now, input), token);
        var result = (await ReadAsync(id, token))!;
        await transaction.CommitAsync(token);
        return result;
    }

    private Task AppendAsync(Guid id, string type, object state, CancellationToken token)
    {
        var history = JsonSerializer.Serialize(new[] { new { schemaVersion = 1, recordType = type, state } }, Json);
        return db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET history=history||{history}::jsonb WHERE id={id}", token);
    }
}

public sealed class DepreciationRow
{
    public Guid ExpenseId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public string Name { get; set; } = "";
    public decimal Cost { get; set; }
    public int? Quantity { get; set; }
    public DateOnly PurchasedOn { get; set; }
    public int Version { get; set; }
    public string Revisions { get; set; } = "[]";
    public string? Disposal { get; set; }
    public string PartialDisposals { get; set; } = "[]";
    public string Receipts { get; set; } = "[]";
}
