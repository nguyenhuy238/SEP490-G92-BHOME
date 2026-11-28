using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record CapitalAssetLine(Guid Id, string Name, int Quantity, string? UnitCost, string? TotalCost);
public sealed record CapitalAssetGroup(string Id, string Name, string Scope, bool Verified,
    string KnownTotal, IReadOnlyList<CapitalAssetLine> Assets);
public sealed record CapitalAssets(Guid LocationId, string KnownTotal, string RoomsTotal, string CommonTotal,
    int UnpricedCount, int UnreviewedRoomCount, int UnreviewedCommonCount,
    IReadOnlyList<CapitalAssetGroup> Groups);
public sealed record CapitalAssetEntry(Guid Id, Guid? RoomId, string? CommonArea, string Name,
    string GroupName, bool Verified, int Quantity, decimal? PurchaseCost,
    DateOnly? PurchaseDate, decimal? SnapshotAmount, bool HasLegacyInvestment,
    decimal? LegacyAmount, Guid? VerifiedBy,
    decimal PendingAmount, IReadOnlyList<AssetCapitalEvent> PendingEvents,
    bool MissingHistoricalPrice, bool CurrentInventoryVerified = false);

public interface ICapitalAssetRepository
{
    Task<bool> LocationExistsAsync(Guid id, CancellationToken token);
    Task<IReadOnlyList<CapitalAssetEntry>> ReadAsync(Guid id, CancellationToken token);
    Task<int> UnreviewedRoomsAsync(Guid id, CancellationToken token);
    Task<int> UnreviewedCommonAsync(Guid id, IReadOnlyList<CapitalAssetEntry> entries, CancellationToken token);
}

public sealed class CapitalAssetService(ICapitalAssetRepository repository, ICurrentUser user)
{
    private static string Vnd(decimal value) => value.ToString("0", CultureInfo.InvariantCulture);

    public async Task<CapitalAssets> ReadAsync(Guid locationId, CancellationToken token)
    {
        if (user.UserId is null || user.UserId == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        if (locationId == Guid.Empty) throw new FinanceException(400, "invalid_finance_filter");
        if (!await repository.LocationExistsAsync(locationId, token))
            throw new FinanceException(404, "finance_scope_not_found");

        var entries = await repository.ReadAsync(locationId, token);
        var groups = entries.GroupBy(e => (e.RoomId, Area: e.RoomId is null ? e.CommonArea ?? "Khu vực chung" : e.GroupName))
            .OrderBy(g => g.Key.RoomId is null).ThenBy(g => g.Key.Area).Select(group =>
            {
                var verified = group.All(e => e.Verified);
                var lines = group.Select(e => new CapitalAssetLine(e.Id, e.Name, e.Quantity,
                    e.PurchaseCost is { } cost ? Vnd(cost) : null,
                    e.SnapshotAmount is { } saved ? Vnd(saved + (e.LegacyAmount ?? 0) + e.PendingAmount) :
                        e.LegacyAmount is { } legacy ? Vnd(legacy) :
                        e.Verified && e.PurchaseCost is not null ? Vnd(e.PendingAmount) : null)).ToArray();
                var known = group.Sum(e => (e.SnapshotAmount ?? 0m) + (e.LegacyAmount ?? 0m)) +
                    group.Where(e => e.Verified).Sum(e => e.PendingAmount);
                return new CapitalAssetGroup(group.Key.RoomId?.ToString() ?? "common:" + group.Key.Area,
                    group.Key.Area, group.Key.RoomId is null ? "common" : "room",
                    verified, Vnd(known), lines);
            }).ToArray();
        var rooms = groups.Where(g => g.Scope == "room").Sum(g => decimal.Parse(g.KnownTotal, CultureInfo.InvariantCulture));
        var common = groups.Where(g => g.Scope == "common").Sum(g => decimal.Parse(g.KnownTotal, CultureInfo.InvariantCulture));
        return new(locationId, Vnd(checked(rooms + common)), Vnd(rooms), Vnd(common),
            entries.Count(e => e.Verified && (
                e.MissingHistoricalPrice ||
                !e.PurchaseCost.HasValue && !e.LegacyAmount.HasValue && !e.SnapshotAmount.HasValue)),
            await repository.UnreviewedRoomsAsync(locationId, token),
            await repository.UnreviewedCommonAsync(locationId, entries, token), groups);
    }
}
