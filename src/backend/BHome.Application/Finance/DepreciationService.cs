using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record DepreciationInput(string Kind, DateOnly InServiceOn, int? UsefulLifeMonths,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal SalvageValue,
    DateOnly? EffectiveFrom, DateOnly? RetiredOn, int ExpectedVersion, string Note);
public sealed record DepreciationRevision(Guid Key, Guid ActorId, DateTimeOffset RecordedAt, DepreciationInput Plan, DateOnly EffectiveFrom);
public sealed record InvestmentDisposalInput(DateOnly DisposedOn,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal SaleAmount,
    int ExpectedVersion, string Note, int? Quantity = null, bool RecognizeInOpenPeriod = false);
public sealed record InvestmentDisposal(Guid Key, Guid ActorId, DateTimeOffset RecordedAt, InvestmentDisposalInput Input,
    DateOnly? RecognizedOn = null)
{
    public DateOnly EffectiveOn => RecognizedOn ?? Input.DisposedOn;
}
public sealed record InvestmentReceiptInput(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly ReceivedOn, int ExpectedVersion, string Note, Guid? DisposalKey = null);
public sealed record InvestmentReceipt(Guid Key, Guid ActorId, DateTimeOffset RecordedAt, InvestmentReceiptInput Input);
public sealed record AssetRepairEvidence(int Count, decimal TotalCost, DateTimeOffset? LatestVerifiedAt);
public sealed record AssetReplacementReview(int RepairCount, string RepairCost, DateTimeOffset? LatestRepairAt,
    int AgeMonths, string? CarryingValue, string? ReplacementCost, string? RepairCostPercent, IReadOnlyList<string> Reasons);
public sealed record DepreciationLot(Guid ExpenseId, Guid LocationId, Guid? RoomId, Guid? AssetId, string Name,
    decimal Cost, int? Quantity, DateOnly PurchasedOn, int Version, IReadOnlyList<DepreciationRevision> Revisions,
    InvestmentDisposal? Disposal = null, IReadOnlyList<InvestmentReceipt>? Receipts = null,
    IReadOnlyList<InvestmentDisposal>? PartialDisposals = null)
{
    public int? RemainingQuantity => Quantity is { } quantity
        ? Disposal is not null ? 0 : quantity - (PartialDisposals?.Sum(s => s.Input.Quantity ?? 0) ?? 0)
        : null;
}
public sealed record PartialDisposalView(InvestmentDisposal Sale, string Received, string Outstanding);
public sealed record DepreciationAmounts(
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Period,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Accumulated,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal CarryingValue,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Monthly);
public sealed record DepreciationView(Guid ExpenseId, Guid LocationId, Guid? RoomId, Guid? AssetId, string Name,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Cost,
    int? Quantity, DateOnly PurchasedOn, int Version, IReadOnlyList<DepreciationRevision> Revisions, DepreciationAmounts? Amounts,
    InvestmentDisposal? Disposal = null, IReadOnlyList<InvestmentReceipt>? Receipts = null,
    string? DisposalReceived = null, string? DisposalOutstanding = null,
    int? RemainingQuantity = null, IReadOnlyList<PartialDisposalView>? PartialDisposals = null);
public sealed record DepreciationPage(IReadOnlyList<DepreciationView> Items, long Total, int Page, int PageSize);
public sealed record DepreciationSource(Guid ExpenseId, Guid LocationId, Guid? RoomId, Guid? AssetId,
    string Name, string Cost, int? Quantity, DateOnly PurchasedOn, DepreciationAmounts? Amounts,
    int? RemainingQuantity = null);
public sealed record DepreciationSourcePage(IReadOnlyList<DepreciationSource> Items, long Total, int Page, int PageSize,
    string? TotalAmount, string KnownAmount, int UnknownLots, DateTimeOffset SnapshotAt);

public static class DepreciationMath
{
    public static DateOnly StartMonth(DateOnly date) => new(date.Year, date.Month, 1);
    public static DateOnly FirstFullMonth(DateOnly date) =>
        date.Day == 1 ? date : StartMonth(date).AddMonths(1);
    private static int MonthIndex(DateOnly date) => (date.Year - 1) * 12 + date.Month - 1;
    private static int EndExclusive(DateOnly date) => MonthIndex(date) +
        (date.Day == DateTime.DaysInMonth(date.Year, date.Month) ? 1 : 0);
    private static decimal Round(decimal value) => decimal.Round(value, 0, MidpointRounding.AwayFromZero);

    // Post at each month end; only full months in service are charged. Rounding
    // cumulative amounts rather than each installment prevents residual drift.
    private static (decimal Accumulated, decimal Monthly) Through(DepreciationLot lot, int endExclusive)
    {
        var disposed = lot.Disposal is { } disposal && endExclusive > MonthIndex(disposal.EffectiveOn);
        if (disposed) endExclusive = Math.Min(endExclusive, MonthIndex(lot.Disposal!.EffectiveOn));
        decimal accumulated = 0;
        decimal monthly = 0;
        for (var i = 0; i < lot.Revisions.Count; i++)
        {
            var revision = lot.Revisions[i];
            var plan = revision.Plan;
            var start = MonthIndex(revision.EffectiveFrom);
            if (start >= endExclusive) break;
            var end = Math.Min(endExclusive, i + 1 == lot.Revisions.Count ? endExclusive : MonthIndex(lot.Revisions[i + 1].EffectiveFrom));
            if (plan.RetiredOn is { } retired) end = Math.Min(end, MonthIndex(retired));
            if (plan.Kind is "Land" or "NonDepreciable" || plan.UsefulLifeMonths is not > 0)
            {
                monthly = 0;
                continue;
            }
            var months = Math.Clamp(end - start, 0, plan.UsefulLifeMonths.Value);
            var basis = Math.Max(0, lot.Cost - accumulated - plan.SalvageValue);
            accumulated += Round(basis * months / plan.UsefulLifeMonths.Value);
            monthly = endExclusive >= start + plan.UsefulLifeMonths.Value ||
                plan.RetiredOn is { } retirement && endExclusive >= MonthIndex(retirement)
                ? 0 : Round(basis / plan.UsefulLifeMonths.Value);
        }
        return (Math.Clamp(accumulated, 0, lot.Cost), disposed ? 0 : monthly);
    }

    public static DepreciationAmounts? Calculate(DepreciationLot lot, DateOnly from, DateOnly to)
    {
        if (lot.Revisions.Count == 0) return null;
        if (lot.PartialDisposals is { Count: > 0 })
        {
            var endPartial = ThroughPartial(lot, to);
            var beforePartial = from == DateOnly.MinValue ? 0 : ThroughPartial(lot, from.AddDays(-1)).Accumulated;
            return new(endPartial.Accumulated - beforePartial, endPartial.Accumulated, endPartial.CarryingValue, endPartial.Monthly);
        }
        var end = Through(lot, EndExclusive(to));
        var before = from == DateOnly.MinValue ? 0 : Through(lot, EndExclusive(from.AddDays(-1))).Accumulated;
        return new(end.Accumulated - before, end.Accumulated,
            lot.Disposal is { } disposal && disposal.EffectiveOn <= to ? 0 : lot.Cost - end.Accumulated,
            lot.Disposal is { } sold && sold.EffectiveOn <= to ? 0 : end.Monthly);
    }

    public static int? QuantityAt(DepreciationLot lot, DateOnly date) =>
        lot.Quantity is not { } quantity ? null :
        lot.Disposal is { } final && final.EffectiveOn <= date ? 0 :
        quantity - (lot.PartialDisposals?.Where(s => s.EffectiveOn <= date).Sum(s => s.Input.Quantity ?? 0) ?? 0);

    // A purchase lot contains homogeneous units with the same price/date/plan.
    // Allocate rounded cumulative depreciation by quantity, freezing sold units
    // before their disposal month. The original expense and prior months remain
    // unchanged. The remaining units retain their proportional original plan.
    private static (decimal Accumulated, decimal CarryingValue, decimal Monthly) ThroughPartial(DepreciationLot lot, DateOnly date)
    {
        var quantity = lot.Quantity ?? throw new FinanceException(409, "investment_quantity_required");
        if (quantity <= 0) throw new FinanceException(409, "investment_quantity_required");
        var original = lot with { Disposal = null };
        var end = EndExclusive(date);
        var disposedQuantity = 0;
        decimal frozen = 0;
        var sales = lot.PartialDisposals!.Concat(lot.Disposal is { } final ? [final] : Array.Empty<InvestmentDisposal>());
        foreach (var sale in sales)
        {
            if (sale.EffectiveOn > date) break;
            var count = sale.Input.Quantity ?? quantity - disposedQuantity;
            if (count <= 0 || count > quantity - disposedQuantity)
                throw new FinanceException(409, "investment_quantity_history_invalid");
            var atSale = Through(original, Math.Min(end, MonthIndex(sale.EffectiveOn))).Accumulated;
            frozen += Round(atSale * (disposedQuantity + count) / quantity) - Round(atSale * disposedQuantity / quantity);
            disposedQuantity += count;
        }
        var scheduled = Through(original, end);
        decimal Remaining(decimal amount) => amount - Round(amount * disposedQuantity / quantity);
        return (frozen + Remaining(scheduled.Accumulated),
            Remaining(lot.Cost - scheduled.Accumulated), Remaining(scheduled.Monthly));
    }

    public static DateOnly Validate(DepreciationLot lot, DepreciationInput input, DateOnly today)
    {
        if (lot.Disposal is not null) throw new FinanceException(409, "investment_already_disposed");
        var depreciable = input.Kind is "Building" or "Equipment";
        if (!depreciable && input.Kind is not ("Land" or "NonDepreciable") ||
            input.InServiceOn < lot.PurchasedOn || input.InServiceOn.Year >= 9999 ||
            input.SalvageValue < 0 || input.SalvageValue > lot.Cost || decimal.Truncate(input.SalvageValue) != input.SalvageValue ||
            (depreciable ? input.UsefulLifeMonths is null or < 1 or > 1200 : input.UsefulLifeMonths is not null || input.SalvageValue != 0) ||
            input.RetiredOn is { } retired && retired < input.InServiceOn ||
            string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_depreciation_plan");
        var effective = input.EffectiveFrom ?? FirstFullMonth(input.InServiceOn);
        if (effective.Day != 1 || effective < FirstFullMonth(input.InServiceOn) || effective.Year >= 9999)
            throw new FinanceException(400, "invalid_depreciation_effective_date");
        if (lot.Revisions.Count > 0)
        {
            var previous = lot.Revisions[^1];
            if (effective <= StartMonth(today) || effective <= previous.EffectiveFrom ||
                input.InServiceOn != previous.Plan.InServiceOn || input.Kind != previous.Plan.Kind ||
                previous.Plan.RetiredOn is not null ||
                input.RetiredOn is { } stop && StartMonth(stop) < effective)
                throw new FinanceException(409, "depreciation_history_immutable");
            var accumulated = Through(lot, MonthIndex(effective)).Accumulated;
            if (input.SalvageValue > lot.Cost - accumulated)
                throw new FinanceException(400, "invalid_depreciation_salvage");
        }
        else if (effective != FirstFullMonth(input.InServiceOn))
            throw new FinanceException(400, "invalid_depreciation_effective_date");
        return effective;
    }
}

public interface IDepreciationRepository
{
    Task<DepreciationLot?> ReadAsync(Guid id, CancellationToken token);
    Task<(IReadOnlyList<DepreciationLot> Lots, long Total)> ListAsync(Guid? locationId, int page, int pageSize, CancellationToken token);
    Task<DepreciationLot> RecordAsync(Guid id, DepreciationInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<DepreciationLot> DisposeAsync(Guid id, InvestmentDisposalInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<DepreciationLot> ReceiveAsync(Guid id, InvestmentReceiptInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<AssetRepairEvidence> RepairsAsync(DepreciationLot lot, DateTimeOffset through, CancellationToken token);
}

public sealed class DepreciationService(IDepreciationRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return id;
    }
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    private DepreciationView View(DepreciationLot lot)
    {
        var today = Today;
        return new(lot.ExpenseId, lot.LocationId, lot.RoomId, lot.AssetId, lot.Name, lot.Cost, lot.Quantity, lot.PurchasedOn,
            lot.Version, lot.Revisions, DepreciationMath.Calculate(lot, DepreciationMath.StartMonth(today), today), lot.Disposal, lot.Receipts,
            lot.Disposal is null ? null : FinancialReportService.Number(lot.Receipts?.Where(r => r.Input.DisposalKey is null).Sum(r => r.Input.Amount) ?? 0),
            lot.Disposal is null ? null : FinancialReportService.Number(lot.Disposal.Input.SaleAmount - (lot.Receipts?.Where(r => r.Input.DisposalKey is null).Sum(r => r.Input.Amount) ?? 0)),
            lot.RemainingQuantity, lot.PartialDisposals?.Select(s =>
            {
                var received = lot.Receipts?.Where(r => r.Input.DisposalKey == s.Key).Sum(r => r.Input.Amount) ?? 0;
                return new PartialDisposalView(s, FinancialReportService.Number(received), FinancialReportService.Number(s.Input.SaleAmount - received));
            }).ToArray());
    }
    public async Task<DepreciationPage> ListAsync(Guid? locationId, int page, int pageSize, CancellationToken token)
    {
        _ = Owner();
        if (locationId == Guid.Empty || page < 1 || pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue)
            throw new FinanceException(400, "invalid_finance_filter");
        var result = await repository.ListAsync(locationId, page, pageSize, token);
        return new(result.Lots.Select(View).ToArray(), result.Total, page, pageSize);
    }
    public async Task<DepreciationView> ReadAsync(Guid id, CancellationToken token)
    {
        _ = Owner();
        return View(await repository.ReadAsync(id, token) ?? throw new FinanceException(404, "investment_not_found"));
    }
    public async Task<AssetReplacementReview> ReplacementReviewAsync(Guid id, decimal? replacementCost, CancellationToken token)
    {
        _ = Owner();
        if (replacementCost is { } cost && (!ValidAmount(cost) || cost == 0))
            throw new FinanceException(400, "invalid_replacement_cost");
        var lot = await repository.ReadAsync(id, token) ?? throw new FinanceException(404, "investment_not_found");
        if (lot.AssetId is null) throw new FinanceException(400, "investment_asset_required");
        var evidence = await repository.RepairsAsync(lot, clock.GetUtcNow(), token);
        return Review(lot, evidence, Today, replacementCost);
    }
    public static AssetReplacementReview Review(DepreciationLot lot, AssetRepairEvidence evidence, DateOnly today, decimal? replacementCost)
    {
        var start = lot.Revisions.FirstOrDefault()?.Plan.InServiceOn ?? lot.PurchasedOn;
        var ageEnd = lot.Disposal is { } disposal && disposal.Input.DisposedOn < today ? disposal.Input.DisposedOn : today;
        var months = Math.Max(0, (ageEnd.Year - start.Year) * 12 + ageEnd.Month - start.Month - (ageEnd.Day < start.Day ? 1 : 0));
        var carrying = DepreciationMath.Calculate(lot, DepreciationMath.StartMonth(today), today)?.CarryingValue;
        var reasons = new List<string>();
        if (evidence.Count > 1) reasons.Add("repeated_repairs");
        decimal? ratio = replacementCost is > 0 ? decimal.Round(evidence.TotalCost / replacementCost.Value * 100, 2, MidpointRounding.AwayFromZero) : null;
        // Return the exact comparison for Owner review. A replacement warning
        // threshold has not been approved; do not invent one from this ratio.
        if (carrying is null) reasons.Add("depreciation_unknown");
        if (lot.Disposal is not null) reasons.Add("lot_disposed");
        string? Number(decimal? value) => value is { } amount ? FinancialReportService.Number(amount) : null;
        return new(evidence.Count, FinancialReportService.Number(evidence.TotalCost), evidence.LatestVerifiedAt, months,
            Number(carrying), Number(replacementCost), Number(ratio), reasons);
    }
    public async Task<DepreciationView> RecordAsync(Guid id, DepreciationInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        return View(await repository.RecordAsync(id, input, key, actor, clock.GetUtcNow(), token));
    }
    private static bool ValidAmount(decimal amount) => amount >= 0 && amount < 1_000_000_000_000_000_000m && amount == decimal.Truncate(amount);
    public async Task<DepreciationView> DisposeAsync(Guid id, InvestmentDisposalInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty || input.DisposedOn == default || input.DisposedOn > Today || !ValidAmount(input.SaleAmount) ||
            input.Quantity is <= 0 || input.ExpectedVersion < 0 || string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_investment_disposal");
        return View(await repository.DisposeAsync(id, input, key, actor, clock.GetUtcNow(), token));
    }
    public async Task<DepreciationView> ReceiveAsync(Guid id, InvestmentReceiptInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty || input.ReceivedOn == default || input.ReceivedOn > Today || !ValidAmount(input.Amount) || input.Amount == 0 ||
            input.ExpectedVersion < 0 || string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_investment_receipt");
        return View(await repository.ReceiveAsync(id, input, key, actor, clock.GetUtcNow(), token));
    }
}
