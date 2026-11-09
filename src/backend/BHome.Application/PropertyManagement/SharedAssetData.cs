using System.Text.Json.Serialization;

namespace BHome.Application.PropertyManagement;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedCatalogSnapshot(Guid FamilyId, int Edition, string Name, string Category, string Unit, decimal ReferencePrice);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedAssetItem(Guid CatalogId, int CatalogVersion, [property: JsonRequired] int Quantity,
    [property: JsonRequired] bool Required, string TrackingMode, SharedCatalogSnapshot? Catalog = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedAssetData(SharedAssetItem[] Items);

public sealed partial class SharedDataValidator
{
    private async Task<SharedAssetData> AssetsAsync(SharedAssetData input, CancellationToken t)
    {
        if (input.Items is null || input.Items.Length is < 1 or > 100) throw new PropertyException(400, "invalid_shared_asset_items");
        var items = new List<SharedAssetItem>(); var families = new HashSet<Guid>();
        foreach (var item in input.Items)
        {
            if (item is null || item.Quantity is < 1 or > 10000 || item.TrackingMode is not ("Serialized" or "BulkQuantity")) throw new PropertyException(400, "invalid_shared_asset_item");
            var catalog = await store.GetAsync(item.CatalogId, "asset-catalog", t) ?? throw new PropertyException(400, "shared_catalog_not_found");
            if (catalog.Status != "Published" || catalog.Version != item.CatalogVersion) throw new PropertyException(409, "shared_catalog_stale_or_unpublished");
            if (!families.Add(catalog.FamilyId)) throw new PropertyException(400, "duplicate_shared_catalog_item");
            var data = Read<SharedCatalogData>(catalog.Data);
            items.Add(item with { Catalog = new(catalog.FamilyId, catalog.Edition, catalog.Name, data.Category, data.Unit, data.ReferencePrice) });
        }
        return new(items.ToArray());
    }
}
