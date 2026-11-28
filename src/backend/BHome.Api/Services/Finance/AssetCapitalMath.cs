namespace BHome.Application.Finance;

public sealed record AssetCapitalRevision(int Version, int Quantity, decimal? UnitCost,
    DateOnly? PurchaseDate, DateOnly? RecordedOn = null, DateTimeOffset? RecordedAt = null);
public sealed record AssetCapitalPosted(string SourceKey, int Quantity, decimal UnitCost,
    decimal Amount, int MetadataVersion);
public sealed record AssetCapitalEvent(string SourceKey, int Quantity, decimal UnitCost,
    decimal Amount, int MetadataVersion, DateOnly? PurchaseDate);

/// <summary>
/// Initial acquisition and later positive quantity changes are separate historic
/// purchases. Updating only a unit price never revalues purchased units.
/// </summary>
public static class AssetCapitalMath
{
    public static IReadOnlyList<AssetCapitalEvent> Pending(Guid assetId, int currentQuantity,
        decimal? currentUnitCost, DateOnly? purchaseDate, int metadataVersion,
        IReadOnlyList<AssetCapitalRevision> revisions, IReadOnlyList<AssetCapitalPosted> posted,
        bool hasLegacyInvestment)
    {
        if (hasLegacyInvestment || currentQuantity < 1) return [];
        var prefix = $"asset-capital:{assetId:N}";
        var sorted = revisions.OrderBy(r => r.Version).ToArray();
        var result = new List<AssetCapitalEvent>();
        var baseline = posted.FirstOrDefault(item =>
            item.SourceKey == prefix + ":base" || item.SourceKey == prefix);
        if (baseline is null)
        {
            // Before the first nightly sync, a room may have had several metadata
            // revisions (e.g. 2 × 2M, then +1 × 2.5M). Capture earliest priced
            // historical quantity/price first, never reprice all 3 units at 2.5M.
            // Explicit zero means a free acquisition, not an unknown price.
            // Preserve its quantity as the historic baseline even though no
            // zero-valued expense must be emitted to the financial ledger.
            var firstPriced = sorted.FirstOrDefault(r => r.Quantity > 0 && r.UnitCost is >= 0);
            var canValueBase = firstPriced is not null &&
                sorted.TakeWhile(r => r.Version <= firstPriced.Version).All(r => r.Quantity == firstPriced.Quantity);
            if (sorted.Length == 0 && currentUnitCost is >= 0)
            {
                firstPriced = new(metadataVersion, currentQuantity, currentUnitCost, purchaseDate);
                canValueBase = true;
            }
            if (canValueBase && firstPriced is not null)
            {
                var initialAmount = checked(firstPriced.Quantity * firstPriced.UnitCost!.Value);
                if (initialAmount > 0 && !posted.Any(p => p.SourceKey == prefix + ":base"))
                    result.Add(new(prefix + ":base", firstPriced.Quantity, firstPriced.UnitCost.Value,
                        initialAmount, firstPriced.Version,
                        firstPriced.PurchaseDate ?? firstPriced.RecordedOn));
                baseline = new(prefix + ":base", firstPriced.Quantity, firstPriced.UnitCost.Value,
                    initialAmount, firstPriced.Version);
            }
            else
            {
                // Some original units have no historical price. Leave their
                // cost unknown; a later price for newly added units must not
                // revalue the original physical quantity.
                if (sorted.Length == 0) return [];
                baseline = new(prefix + ":unpriced", sorted[0].Quantity, 0, 0, sorted[0].Version);
            }
        }
        var existing = posted.Select(item => item.SourceKey).ToHashSet(StringComparer.Ordinal);
        var previousQuantity = baseline.Quantity;
        var unpricedQuantity = 0;
        foreach (var revision in sorted.Where(r => r.Version > baseline.MetadataVersion))
        {
            if (revision.Quantity < 1) continue;
            var delta = revision.Quantity - previousQuantity;
            previousQuantity = revision.Quantity;
            unpricedQuantity = Math.Max(0, unpricedQuantity + delta);
            if (revision.UnitCost is 0m)
            {
                // A zero-cost purchase settles quantities acquired since the
                // previous revision without a ledger entry. Do not charge
                // these free units if the Owner later edits only the price.
                unpricedQuantity = 0;
                continue;
            }
            if (unpricedQuantity == 0 || revision.UnitCost is not > 0) continue;
            var key = $"{prefix}:version:{revision.Version}";
            if (!existing.Contains(key))
                result.Add(new(key, unpricedQuantity, revision.UnitCost.Value,
                    checked(unpricedQuantity * revision.UnitCost.Value), revision.Version,
                    revision.PurchaseDate ?? revision.RecordedOn));
            unpricedQuantity = 0;
        }
        return result;
    }

    public static bool HasMissingHistoricalPrice(IReadOnlyList<AssetCapitalRevision> revisions,
        IReadOnlyList<AssetCapitalPosted> posted)
    {
        if (posted.Any(p => p.SourceKey.EndsWith(":base", StringComparison.Ordinal) ||
                            p.SourceKey.Count(c => c == ':') == 1))
            return false;
        var sorted = revisions.OrderBy(r => r.Version).ToArray();
        if (sorted.Length == 0) return false;
        var firstPriced = sorted.FirstOrDefault(r => r.Quantity > 0 && r.UnitCost is >= 0);
        return firstPriced is null || sorted.TakeWhile(r => r.Version <= firstPriced.Version)
            .Any(r => r.Quantity != firstPriced.Quantity);
    }
}
