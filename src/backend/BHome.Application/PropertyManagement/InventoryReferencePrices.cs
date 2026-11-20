namespace BHome.Application.PropertyManagement;

/// <summary>
/// Read-only suggestion for legacy location requirements that predate
/// reference-price snapshots. Use a published catalog entry only when its
/// name, category and unit uniquely identify one matching family.
/// Ambiguity means unknown, never an arbitrary catalog price.
/// </summary>
internal static class InventoryReferencePrices
{
    private static string Key(string name, string category, string? unit) =>
        string.Join("\u001f", name.Trim().ToUpperInvariant(), category.Trim().ToUpperInvariant(),
            (unit ?? "").Trim().ToUpperInvariant());

    internal static async Task<IReadOnlyDictionary<string, decimal>> ReadAsync(
        ISharedConfigurationStore? shared, string scope, CancellationToken token)
    {
        if (shared is null) return new Dictionary<string, decimal>();
        var candidates = new Dictionary<string, List<decimal>>(StringComparer.Ordinal);
        for (var page = 1; ; page++)
        {
            var result = await shared.ListAsync("asset-catalog", "", "Published", page, 100, token, latestOnly: true);
            foreach (var entry in result.Items)
            {
                if (entry.Status != "Published") continue;
                var data = SharedDataValidator.Read<SharedCatalogData>(entry.Data);
                if (scope == "Room" && data.Scope == "Location" ||
                    scope == "Location" && data.Scope == "Room") continue;
                var key = Key(entry.Name, data.Category, data.Unit);
                if (!candidates.TryGetValue(key, out var list)) candidates[key] = list = [];
                list.Add(data.ReferencePrice);
            }
            if (page * 100 >= result.Total || result.Items.Count == 0) break;
        }
        return candidates.Where(kv => kv.Value.Count == 1)
            .ToDictionary(kv => kv.Key, kv => kv.Value[0], StringComparer.Ordinal);
    }

    internal static decimal? Suggest(IReadOnlyDictionary<string, decimal> prices,
        string name, string category, string? unit) =>
        prices.TryGetValue(Key(name, category, unit), out var value) ? value : null;
}
