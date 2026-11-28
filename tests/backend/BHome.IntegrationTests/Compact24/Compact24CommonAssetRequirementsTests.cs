using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task CommonAssetRequirementsAreVersionedIndependentAndCopyable()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var item = new SetupCommonAssetRequirement(Guid.NewGuid(), "Shared chair", "Furniture", "BulkQuantity", 6, "Lobby", "item");
        var emptyRoute = $"/api/v1/locations/{w.Location}/common-asset-requirements";
        Assert.Null(await owner.GetFromJsonAsync<SetupDocument>(emptyRoute));
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsJsonAsync(emptyRoute, new CommonAssetRequirementsWrite([item]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(emptyRoute, new CommonAssetRequirementsWrite([item, item]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(emptyRoute, new CommonAssetRequirementsWrite([item with { CommonArea = "" }]))).StatusCode);
        var draft = SetupDraft() with { CommonAssets = [item] };
        var result = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, Guid.NewGuid()));
        var route = $"/api/v1/locations/{result.Location.Id}/common-asset-requirements";
        var document = (await owner.GetFromJsonAsync<SetupDocument>(route))!;
        Assert.Equal("CommonAssetRequirements", document.Kind); Assert.Equal(1, document.Version);
        Assert.Contains(document.Id, result.CreatedReferences);
        Assert.Equal(6, document.Data.GetProperty("items")[0].GetProperty("quantity").GetInt32());
        var sourceRoute = $"{SetupRoute}/source/{result.Location.Id}";
        var source = (await owner.GetFromJsonAsync<LocationSetupSource>(sourceRoute))!;
        Assert.Equal(document.Id, source.CommonAssets!.Id);
        var copy = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft() with
        {
            SourceLocationId = result.Location.Id,
            SourceState = source.SourceState,
            SourceReferences = [new(document.Id, document.Version, document.Kind)],
            CommonAssets = [item with { Id = Guid.NewGuid() }]
        }, Guid.NewGuid()));
        var updated = await Read<SetupDocument>(await owner.PutAsJsonAsync(route, new CommonAssetRequirementsWrite([item with { Quantity = 8 }], document.Version)));
        Assert.Equal(2, updated.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, new CommonAssetRequirementsWrite([], document.Version))).StatusCode);
        Assert.NotEqual(source.SourceState, (await owner.GetFromJsonAsync<LocationSetupSource>(sourceRoute))!.SourceState);
        var copyDocument = (await owner.GetFromJsonAsync<SetupDocument>($"/api/v1/locations/{copy.Location.Id}/common-asset-requirements"))!;
        Assert.Equal(6, copyDocument.Data.GetProperty("items")[0].GetProperty("quantity").GetInt32());
        var removed = await Read<SetupDocument>(await owner.PutAsJsonAsync(route, new CommonAssetRequirementsWrite([], updated.Version)));
        Assert.Equal(0, removed.Data.GetProperty("items").GetArrayLength());
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.False(await db.Set<Asset>().AnyAsync(a => a.LocationId == result.Location.Id || a.LocationId == copy.Location.Id));
        Assert.Equal(3, (await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().HistoryAsync(document.Id, document.Kind, default)).Count);
    }

    [CompactPostgresFact]
    public async Task CatalogScopeRejectsLocationAssetsInRoomTemplatesAndPreservesLegacy()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string catalogRoute = "/api/v1/shared-configuration/asset-catalog";
        var legacy = await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute, SharedInput("asset-catalog")));
        Assert.Equal("Both", legacy.Data.GetProperty("scope").GetString());
        var input = SharedInput("asset-catalog") with { Data = JsonSerializer.SerializeToElement(new { category = "Furniture", unit = "item", referencePrice = 100, scope = "Location" }) };
        var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute, input));
        var published = await Read<SharedDocument>(await owner.PostAsJsonAsync($"{catalogRoute}/{draft.Id}/publish", new SharedVersion(draft.Version)));
        var items = new[] { new SharedAssetItem(published.Id, published.Version, 2, true, "Serialized") };
        var room = SharedInput("room-type-templates") with { Data = JsonSerializer.SerializeToElement(new { capacity = 2, area = 20, amenities = Array.Empty<string>(), referenceRent = 100, assetItems = items }, new JsonSerializerOptions(JsonSerializerDefaults.Web)) };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/room-type-templates", room)).StatusCode);
        var generic = new SharedWrite("Synthetic shared assets", "Package", JsonSerializer.SerializeToElement(new SharedAssetData(items), new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        var package = await Read<SharedDocument>(await owner.PostAsJsonAsync("/api/v1/shared-configuration/asset-templates", generic));
        Assert.Equal("Location", package.Data.GetProperty("items")[0].GetProperty("catalog").GetProperty("scope").GetString());
    }

    [CompactPostgresFact]
    public async Task PhysicalAssetInitialQuantityAndUnitArePersistedAndReturned()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var input = new AssetWrite(w.Location, null, "Lobby", "BULK-CHAIR", "Chair", "Furniture", "Good",
            InitialUnit: "item", InitialTrackingMode: "BulkQuantity", InitialQuantity: 4);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/assets", input with { InitialTrackingMode = "Serialized" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/assets", input with { InitialQuantity = 0 })).StatusCode);
        var created = await Read<AssetDto>(await owner.PostAsJsonAsync("/api/v1/assets", input));
        Assert.Equal(4, created.Quantity); Assert.Equal("BulkQuantity", created.TrackingMode); Assert.Equal("item", created.Unit);
        var detail = (await owner.GetFromJsonAsync<AssetDto>($"/api/v1/assets/{created.Id}"))!;
        Assert.Equal(created, detail);
        var list = (await owner.GetFromJsonAsync<PagedResult<AssetDto>>($"/api/v1/assets?locationId={w.Location}&commonAreaOnly=true"))!;
        Assert.Equal(created, Assert.Single(list.Items));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/api/v1/assets/{created.Id}", input with { Version = created.Version })).StatusCode);
        var changed = await Read<AssetDto>(await owner.PutAsJsonAsync($"/api/v1/assets/{created.Id}", input with
        {
            Version = created.Version,
            InitialTrackingMode = null,
            InitialQuantity = null,
            InitialUnit = null,
            Name = "Edited chair"
        }));
        Assert.Equal(4, changed.Quantity); Assert.Equal("item", changed.Unit);
    }
}
