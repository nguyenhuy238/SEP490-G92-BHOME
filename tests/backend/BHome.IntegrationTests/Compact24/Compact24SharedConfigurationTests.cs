using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private static SharedWrite SharedInput(string resource) => new("Synthetic " + Guid.NewGuid().ToString("N"), "Synthetic shared reference", JsonSerializer.SerializeToElement(resource switch
    {
        "room-type-templates" => (object)new { capacity = 3, area = "25.0001", amenities = new[] { "Synthetic amenity" }, referenceRent = "3500000.0001" },
        "asset-catalog" => new { category = "Synthetic furniture", unit = "item", referencePrice = "1500000.0001" },
        "fee-templates" => new { category = "Rent", chargeCode = "RENT", method = "FixedPerRoomPerMonth", referenceRate = "3500000.0001", unit = "VND/month", scope = "Location", effectiveFrom = Today.ToString("yyyy-MM-dd"), effectiveTo = (string?)null },
        "policy-templates" => new { content = "Synthetic reusable content", effectiveFrom = Today.ToString("yyyy-MM-dd") },
        _ => throw new InvalidOperationException()
    }));

    [CompactPostgresFact]
    public async Task SharedAssetPackagesValidateCatalogVersionsAndFreezeReferenceFields()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        const string catalogRoute = "/api/v1/shared-configuration/asset-catalog"; const string route = "/api/v1/shared-configuration/asset-templates";
        var catalog = await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute, SharedInput("asset-catalog")));
        SharedWrite Package(params SharedAssetItem[] items) => new("Synthetic " + Guid.NewGuid().ToString("N"), "Package", JsonSerializer.SerializeToElement(new SharedAssetData(items)));
        var item = new SharedAssetItem(catalog.Id, 1, 2, false, "BulkQuantity");
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, Package(item))).StatusCode);
        catalog = await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute + "/" + catalog.Id + "/publish", new SharedVersion(1)));
        item = item with { CatalogVersion = catalog.Version };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(route, Package(item, item))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(route, Package(item with { Quantity = 0 }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        var input = Package(item); var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        Assert.Equal(catalog.Name, draft.Data.GetProperty("items")[0].GetProperty("catalog").GetProperty("name").GetString());
        draft = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + draft.Id, input with { Data = JsonSerializer.SerializeToElement(new SharedAssetData([item with { Required = true, Quantity = 3 }])), ExpectedVersion = 1 }));
        var published = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/publish", new SharedVersion(2)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + draft.Id, input with { ExpectedVersion = published.Version })).StatusCode);
        var copy = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/duplicate", new SharedDuplicate(input.Name + " copy", published.Version)));
        Assert.NotEqual(copy.FamilyId, draft.FamilyId);
        var next = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/versions", new SharedVersion(published.Version)));
        Assert.Equal(2, next.Edition);
        Assert.Equal(3, (await owner.GetFromJsonAsync<SharedDocument[]>(route + "/" + draft.Id + "/history"))!.Length);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, input with { Name = input.Name.ToUpperInvariant() })).StatusCode);
    }

    [CompactPostgresFact] public Task SharedRoomCrud() => SharedCrudRejectsConflictsAndPreservesPublishedEditions("room-type-templates");
    [CompactPostgresFact] public Task SharedCatalogCrud() => SharedCrudRejectsConflictsAndPreservesPublishedEditions("asset-catalog");
    [CompactPostgresFact] public Task SharedFeeCrud() => SharedCrudRejectsConflictsAndPreservesPublishedEditions("fee-templates");
    [CompactPostgresFact] public Task SharedPolicyCrud() => SharedCrudRejectsConflictsAndPreservesPublishedEditions("policy-templates");
    private async Task SharedCrudRejectsConflictsAndPreservesPublishedEditions(string resource)
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); using var tenant = await Client(w.Tenant);
        var route = "/api/v1/shared-configuration/" + resource; var input = SharedInput(resource);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
        var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        Assert.Equal("BHOME", draft.ManagementScope); Assert.Equal(w.Owner.Id, draft.CreatedBy);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + draft.Id, input)).StatusCode);
        var edited = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + draft.Id, input with { ExpectedVersion = 1, Description = "Edited" }));
        var published = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/publish", new SharedVersion(edited.Version)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + draft.Id, input with { ExpectedVersion = published.Version })).StatusCode);
        var next = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/versions", new SharedVersion(published.Version)));
        Assert.Equal(draft.FamilyId, next.FamilyId); Assert.Equal(2, next.Edition); Assert.Equal(1, next.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/" + draft.Id + "/versions", new SharedVersion(published.Version))).StatusCode);
        var duplicate = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/duplicate", new SharedDuplicate(input.Name + " copy", published.Version)));
        Assert.NotEqual(draft.FamilyId, duplicate.FamilyId);
        Assert.Equal(3, (await owner.GetFromJsonAsync<SharedDocument[]>(route + "/" + draft.Id + "/history"))!.Length);
        var page = await owner.GetFromJsonAsync<SharedPage>(route + "?search=" + Uri.EscapeDataString(input.Name) + "&status=Published&pageSize=1");
        Assert.Single(page!.Items); Assert.Equal(1, page.Total);
        var reloaded = await owner.GetFromJsonAsync<SharedDocument>(route + "/" + draft.Id);
        if (resource == "policy-templates") Assert.Equal("Synthetic reusable content", reloaded!.Data.GetProperty("content").GetString());
        else Assert.Equal(resource == "asset-catalog" ? "1500000.0001" : "3500000.0001", reloaded!.Data.GetProperty(resource == "asset-catalog" ? "referencePrice" : resource == "fee-templates" ? "referenceRate" : "referenceRent").GetString());
        await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/archive", new SharedVersion(published.Version)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + draft.Id, input with { ExpectedVersion = published.Version + 1 })).StatusCode);
    }
    [CompactPostgresFact]
    public async Task SharedRoomAndCatalogRejectUnknownAndInvalidData()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        foreach (var data in new object[] { new { capacity = 0, area = "25", amenities = Array.Empty<string>() }, new { capacity = 2, area = "25", amenities = new[] { "A", "a" } }, new { capacity = 2, area = "25", amenities = Array.Empty<string>(), roomTypeId = (string?)null } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/room-type-templates", SharedInput("room-type-templates") with { Data = JsonSerializer.SerializeToElement(data) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/asset-catalog", SharedInput("asset-catalog") with { Data = JsonSerializer.SerializeToElement(new { category = "Synthetic", unit = "item", referencePrice = "-1" }) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync("/api/v1/shared-configuration/room-types")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/room-type-templates", new { name = "Missing data", description = "Synthetic" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/room-type-templates", new { name = "Unknown top-level member", description = "Synthetic", data = SharedInput("room-type-templates").Data, roomTypeId = (string?)null })).StatusCode);
    }
    [CompactPostgresFact]
    public async Task SharedFeesAndPoliciesValidateDomainRulesWithoutCreatingOperationalRecords()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var badFees = new object[] {
            new { category = "Rent", chargeCode = "RENT", method = "Metered", referenceRate = "1", unit = "VND", scope = "Location", effectiveFrom = Today },
            new { category = "Electricity", chargeCode = "WATER", method = "Metered", referenceRate = "1", unit = "VND", scope = "Location", effectiveFrom = Today },
            new { category = "Water", chargeCode = "WATER", method = "Metered", referenceRate = "-1", unit = "VND", scope = "Location", effectiveFrom = Today }
        };
        foreach (var data in badFees) Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/fee-templates", SharedInput("fee-templates") with { Data = JsonSerializer.SerializeToElement(data) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/policy-templates", SharedInput("policy-templates") with { Data = JsonSerializer.SerializeToElement(new { content = "", effectiveFrom = Today }) })).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<PagedResult<PolicyDto>>("/api/v1/billing-policies?locationId=" + w.Location))!.Items);
        Assert.Empty((await owner.GetFromJsonAsync<SetupDocument[]>("/api/v1/operating-policies?locationId=" + w.Location))!);
    }
}
