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
        "asset-templates" => new { items = Array.Empty<SharedAssetItem>() },
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
        var archivedDuplicate = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + duplicate.Id + "/archive", new SharedVersion(duplicate.Version)));
        var restoredDuplicate = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + duplicate.Id + "/restore", new SharedVersion(archivedDuplicate.Version)));
        Assert.Equal("Draft", restoredDuplicate.Status); Assert.Equal(archivedDuplicate.Version + 1, restoredDuplicate.Version);
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
    public async Task SharedImmediateSaveEditsUnusedAndVersionsAppliedDocumentsWithoutChangingTargets()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string route = "/api/v1/shared-configuration/room-type-templates";
        var input = SharedInput("room-type-templates") with { PublishImmediately = true };
        var created = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        Assert.Equal("Published", created.Status); Assert.Equal(1, created.Edition); Assert.Equal(1, created.Version);
        var edited = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + created.Id,
            input with { ExpectedVersion = created.Version, Description = "Updated before use" }));
        Assert.Equal(created.Id, edited.Id); Assert.Equal(1, edited.Edition); Assert.Equal(2, edited.Version);
        var unchanged = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + edited.Id,
            input with { ExpectedVersion = edited.Version, Description = edited.Description }));
        Assert.Equal(edited.Version, unchanged.Version);
        var apply = new SharedApply(w.Location, edited.Version);
        var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/" + edited.Id + "/apply-preview", apply));
        Assert.True(plan.CanProceed);
        var operation = await Read<SharedOperation>(await Keyed(owner, route + "/" + edited.Id + "/apply", apply with { TargetState = plan.TargetState }, Guid.NewGuid()));
        var usedUnchanged = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + edited.Id,
            input with { ExpectedVersion = edited.Version, Description = edited.Description }));
        Assert.Equal(edited.Id, usedUnchanged.Id); Assert.Equal(edited.Version, usedUnchanged.Version);
        var next = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + edited.Id,
            input with { ExpectedVersion = edited.Version, Name = input.Name + " latest", Description = "Updated after use" }));
        Assert.NotEqual(edited.Id, next.Id); Assert.Equal(edited.FamilyId, next.FamilyId);
        Assert.Equal(2, next.Edition); Assert.Equal(1, next.Version); Assert.Equal("Published", next.Status);
        Assert.Equal("Updated before use", (await owner.GetFromJsonAsync<SharedDocument>(route + "/" + edited.Id))!.Description);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + edited.Id, input with { ExpectedVersion = edited.Version })).StatusCode);
        var page = (await owner.GetFromJsonAsync<SharedPage>(route + "?status=Published&latestOnly=true&search=" + Uri.EscapeDataString(input.Name)))!;
        Assert.Single(page.Items); Assert.Equal(next.Id, page.Items[0].Id); Assert.Equal(1, page.Total);
        var oldName = (await owner.GetFromJsonAsync<SharedPage>(route + "?status=Published&latestOnly=false&search=" + Uri.EscapeDataString(input.Name)))!;
        Assert.Equal(2, oldName.Total);
        var archived = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + next.Id + "/archive", new SharedVersion(next.Version, WholeFamily: true)));
        Assert.All((await owner.GetFromJsonAsync<SharedDocument[]>(route + "/" + next.Id + "/versions"))!, v => Assert.Equal("Archived", v.Status));
        Assert.Empty((await owner.GetFromJsonAsync<SharedPage>(route + "?status=Published&latestOnly=true&search=" + Uri.EscapeDataString(input.Name)))!.Items);
        var restored = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + archived.Id + "/restore", new SharedVersion(archived.Version, WholeFamily: true)));
        Assert.Equal(next.Id, restored.Id); Assert.Equal("Published", restored.Status);
        var copy = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + restored.Id + "/duplicate",
            new SharedDuplicate(input.Name + " independent", restored.Version, PublishImmediately: true)));
        Assert.Equal("Published", copy.Status); Assert.NotEqual(restored.FamilyId, copy.FamilyId);
        Assert.Empty((await owner.GetFromJsonAsync<SharedPage>(route + "?status=Archived&latestOnly=true&search=" + Uri.EscapeDataString(input.Name)))!.Items);
        var local = await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/locations/{w.Location}/room-defaults");
        var target = Assert.Single(local!, d => d.Id == operation.CreatedReferences[0]);
        Assert.Equal(input.Name, target.Data.GetProperty("name").GetString());
        Assert.Equal(1, target.Version);
    }

    [CompactPostgresFact]
    public async Task SharedImmediateSaveRecognizesSetupProvenanceAndCompletesLegacyDraft()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string route = "/api/v1/shared-configuration/policy-templates";
        var input = SharedInput("policy-templates");
        var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        var current = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + draft.Id,
            input with { ExpectedVersion = draft.Version, PublishImmediately = true }));
        Assert.Equal(draft.Id, current.Id); Assert.Equal("Published", current.Status);
        var setup = SetupDraft() with { SourceReferences = [new(current.Id, current.Version, current.Resource)] };
        var created = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, setup, Guid.NewGuid()));
        var next = await Read<SharedDocument>(await owner.PutAsJsonAsync(route + "/" + current.Id,
            input with { ExpectedVersion = current.Version, PublishImmediately = true, Description = "Changed after setup" }));
        Assert.Equal(2, next.Edition); Assert.NotEqual(current.Id, next.Id);
        Assert.Equal(current.Description, (await owner.GetFromJsonAsync<SharedDocument>(route + "/" + current.Id))!.Description);
        var usage = (await owner.GetFromJsonAsync<SharedUsage>(route + "/" + next.Id + "/applications"))!;
        var applied = Assert.Single(usage.Items);
        Assert.Equal(1, usage.LocationsUsing); Assert.Equal(1, usage.Total);
        Assert.Equal(current.Id, applied.SourceId); Assert.Equal(current.Version, applied.SourceVersion);
        Assert.Equal(current.Edition, applied.SourceEdition); Assert.Equal(created.Location.Id, applied.TargetLocationId);
        var saved = await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/operating-policies?locationId={created.Location.Id}");
        Assert.Equal(setup.Policy!.Content, Assert.Single(saved!).Data.GetProperty("content").GetString());
    }

    [CompactPostgresFact]
    public async Task SharedImmediateCatalogPreservesNestedReferencesAndRejectsInvalidRestore()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string catalogRoute = "/api/v1/shared-configuration/asset-catalog";
        const string roomRoute = "/api/v1/shared-configuration/room-type-templates";
        var catalogInput = SharedInput("asset-catalog") with { PublishImmediately = true };
        var catalog = await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute, catalogInput));
        var item = new SharedAssetItem(catalog.Id, catalog.Version, 2, true, "BulkQuantity");
        var roomInput = SharedInput("room-type-templates") with
        {
            PublishImmediately = true,
            Data = JsonSerializer.SerializeToElement(new
            {
                capacity = 3,
                area = 25,
                amenities = Array.Empty<string>(),
                referenceRent = 3500000,
                assetItems = new[] { item }
            })
        };
        var room = await Read<SharedDocument>(await owner.PostAsJsonAsync(roomRoute, roomInput));
        var nextCatalog = await Read<SharedDocument>(await owner.PutAsJsonAsync(catalogRoute + "/" + catalog.Id,
            catalogInput with { ExpectedVersion = catalog.Version, Name = catalog.Name + " new" }));
        Assert.Equal(2, nextCatalog.Edition); Assert.NotEqual(catalog.Id, nextCatalog.Id);
        var frozen = (await owner.GetFromJsonAsync<SharedDocument>(roomRoute + "/" + room.Id))!.Data.GetProperty("assetItems")[0];
        Assert.Equal(catalog.Name, frozen.GetProperty("catalog").GetProperty("name").GetString());
        Assert.Equal(catalog.Id, frozen.GetProperty("catalogId").GetGuid());
        var archivedRoom = await Read<SharedDocument>(await owner.PostAsJsonAsync(roomRoute + "/" + room.Id + "/archive", new SharedVersion(room.Version, WholeFamily: true)));
        await Read<SharedDocument>(await owner.PostAsJsonAsync(catalogRoute + "/" + nextCatalog.Id + "/archive", new SharedVersion(nextCatalog.Version, WholeFamily: true)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(roomRoute + "/" + room.Id + "/restore", new SharedVersion(archivedRoom.Version, WholeFamily: true))).StatusCode);
        Assert.Equal("Archived", (await owner.GetFromJsonAsync<SharedDocument>(roomRoute + "/" + room.Id))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(roomRoute, roomInput with { Name = roomInput.Name + " invalid" })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task SharedTemplateNamesRemainReservedAfterArchiveAndNormalizeWhitespace()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string route = "/api/v1/shared-configuration/room-type-templates";
        var input = SharedInput("room-type-templates") with { Name = "Phòng 3 giường " + Guid.NewGuid().ToString("N") };
        var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        var equivalent = input with { Name = "  " + input.Name.ToUpperInvariant().Replace(" ", "   ").Normalize(System.Text.NormalizationForm.FormD) + "  " };
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, equivalent)).StatusCode);
        var archived = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/archive", new SharedVersion(draft.Version)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, equivalent)).StatusCode);
        var other = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input with { Name = input.Name + " khác" }));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route + "/" + other.Id, equivalent with { ExpectedVersion = other.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/" + other.Id + "/duplicate", new SharedDuplicate(equivalent.Name, other.Version))).StatusCode);
        var restored = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/restore", new SharedVersion(archived.Version)));
        var published = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/publish", new SharedVersion(restored.Version)));
        var next = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/versions", new SharedVersion(published.Version)));
        Assert.Equal(draft.FamilyId, next.FamilyId);
        Assert.Equal(2, next.Edition);
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
        const string route = "/api/v1/shared-configuration/fee-templates";
        foreach (var (category, code, method, unit, expected) in new[] {
            ("Rent", "RENT", "FixedPerRoomPerMonth", "VND / th\u00e1ng", "VND/month"),
            ("Electricity", "electricity", "Metered", "VND / kWh", "kWh"),
            ("Water", "water", "Metered", "m3", "m\u00b3"),
            ("ServiceFee", "internet", "FixedPerRoomPerMonth", "VND/month", "VND/month"),
            ("ServiceFee", "cleaning", "FixedPerPersonPerMonth", "VND/person/month", "VND/person/month") })
        {
            var data = JsonSerializer.SerializeToElement(new { category, chargeCode = code, method, referenceRate = "1000", unit, scope = "Location", effectiveFrom = Today });
            var saved = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, SharedInput("fee-templates") with { Data = data }));
            Assert.Equal(expected, saved.Data.GetProperty("unit").GetString());
            Assert.Equal(code.ToUpperInvariant(), saved.Data.GetProperty("chargeCode").GetString());
        }
        var badFees = new object[] {
            new { category = "ServiceFee", chargeCode = "CLEANING", method = "FixedPerPersonPerMonth", referenceRate = "1", unit = "VND/month", scope = "Location", effectiveFrom = Today },
            new { category = "Water", chargeCode = "WATER", method = "Metered", referenceRate = "1", unit = "kWh", scope = "Location", effectiveFrom = Today },
            new { category = "Electricity", chargeCode = "ELECTRICITY", method = "Metered", referenceRate = "1", unit = "VND/month", scope = "Location", effectiveFrom = Today },
            new { category = "ServiceFee", chargeCode = "WATER", method = "FixedPerRoomPerMonth", referenceRate = "1", unit = "VND/month", scope = "Location", effectiveFrom = Today },
            new { category = "ServiceFee", chargeCode = "INTERNET", method = "FixedPerRoomPerMonth", referenceRate = "1", unit = "m3", scope = "Location", effectiveFrom = Today },
            new { category = "Rent", chargeCode = "RENT", method = "Metered", referenceRate = "1", unit = "VND", scope = "Location", effectiveFrom = Today },
            new { category = "Electricity", chargeCode = "WATER", method = "Metered", referenceRate = "1", unit = "VND", scope = "Location", effectiveFrom = Today },
            new { category = "Water", chargeCode = "WATER", method = "Metered", referenceRate = "-1", unit = "VND", scope = "Location", effectiveFrom = Today }
        };
        foreach (var data in badFees) Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/fee-templates", SharedInput("fee-templates") with { Data = JsonSerializer.SerializeToElement(data) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/shared-configuration/policy-templates", SharedInput("policy-templates") with { Data = JsonSerializer.SerializeToElement(new { content = "", effectiveFrom = Today }) })).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<PagedResult<PolicyDto>>("/api/v1/billing-policies?locationId=" + w.Location))!.Items);
        Assert.Empty((await owner.GetFromJsonAsync<SetupDocument[]>("/api/v1/operating-policies?locationId=" + w.Location))!);
    }

    [CompactPostgresFact]
    public async Task ServiceTypesGenerateUniqueInitialCodesAndReuseSavedNames()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string route = "/api/v1/shared-configuration/fee-templates";
        var missingServiceName = SharedInput("fee-templates") with
        {
            Data = JsonSerializer.SerializeToElement(new
            {
                category = "ServiceFee",
                chargeCode = "DV_MISSING",
                method = "FixedPerRoomPerMonth",
                referenceRate = "1000",
                unit = "VND/month",
                scope = "Location",
                effectiveFrom = Today.ToString("yyyy-MM-dd"),
                effectiveTo = (string?)null
            })
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(route, missingServiceName)).StatusCode);
        SharedWrite Service(string templateName, string serviceName, string chargeCode) =>
            SharedInput("fee-templates") with
            {
                Name = templateName,
                Data = JsonSerializer.SerializeToElement(new
                {
                    category = "ServiceFee",
                    chargeCode,
                    serviceName,
                    method = "FixedPerRoomPerMonth",
                    referenceRate = "1000",
                    unit = "VND/month",
                    scope = "Location",
                    effectiveFrom = Today.ToString("yyyy-MM-dd"),
                    effectiveTo = (string?)null
                })
            };

        var first = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic laundry template", "Giặt sấy", "")));
        Assert.Equal("DV_GS", first.Data.GetProperty("chargeCode").GetString());
        Assert.Equal("Giặt sấy", first.Data.GetProperty("serviceName").GetString());

        var reused = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic second laundry template", "Giặt sấy", "")));
        Assert.Equal("DV_GS", reused.Data.GetProperty("chargeCode").GetString());

        first = await Read<SharedDocument>(await owner.PutAsJsonAsync(
            $"{route}/{first.Id}", Service("Synthetic laundry template", "Dịch vụ giặt", "") with { ExpectedVersion = first.Version }));
        Assert.Equal("DV_GS", first.Data.GetProperty("chargeCode").GetString());
        Assert.Equal("Dịch vụ giặt", first.Data.GetProperty("serviceName").GetString());

        var collision = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic grooming template", "Gội sấy", "DV_GS")));
        Assert.Equal("DV_GS_02", collision.Data.GetProperty("chargeCode").GetString());

        var reusedAgain = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic third laundry template", "Giặt sấy", "")));
        Assert.Equal("DV_GS", reusedAgain.Data.GetProperty("chargeCode").GetString());
        Assert.Equal("Giặt sấy", reusedAgain.Data.GetProperty("serviceName").GetString());

        var punctuation = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic hyphenated laundry template", "Giặt-sấy", "")));
        Assert.Equal("DV_GS_03", punctuation.Data.GetProperty("chargeCode").GetString());

        var wifi = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic wifi template", "Wifi", "")));
        Assert.Equal("DV_W", wifi.Data.GetProperty("chargeCode").GetString());
        var wifiReuse = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            route, Service("Synthetic second wifi template", "Wifi", "")));
        Assert.Equal("DV_W", wifiReuse.Data.GetProperty("chargeCode").GetString());
    }

    [CompactPostgresFact]
    public async Task FeeTemplateOverlapIsCheckedWhenPublishingAndOnlyAgainstOtherPublishedFamilies()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        const string route = "/api/v1/shared-configuration/fee-templates";
        var start = Today.AddYears(10);
        var end = start.AddDays(30);
        JsonElement Data(DateOnly from, DateOnly to) => JsonSerializer.SerializeToElement(new
        {
            category = "Rent",
            chargeCode = "RENT",
            method = "FixedPerRoomPerMonth",
            referenceRate = "1000",
            unit = "VND/month",
            scope = "Room",
            effectiveFrom = from.ToString("yyyy-MM-dd"),
            effectiveTo = to.ToString("yyyy-MM-dd")
        });

        // Drafts are not selectable and do not reserve an effective period.
        var first = await Read<SharedDocument>(await owner.PostAsJsonAsync(route,
            SharedInput("fee-templates") with { Data = Data(start, end) }));
        var second = await Read<SharedDocument>(await owner.PostAsJsonAsync(route,
            SharedInput("fee-templates") with { Data = Data(start, end) }));
        var published = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            $"{route}/{first.Id}/publish", new SharedVersion(first.Version)));
        Assert.Equal("Published", published.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(
            $"{route}/{second.Id}/publish", new SharedVersion(second.Version))).StatusCode);

        // An adjacent, non-overlapping period for the same policy remains publishable.
        var nextStart = end.AddDays(1);
        var nextEnd = nextStart.AddDays(30);
        var next = await Read<SharedDocument>(await owner.PostAsJsonAsync(route,
            SharedInput("fee-templates") with { Data = Data(nextStart, nextEnd) }));
        var nextPublished = await Read<SharedDocument>(await owner.PostAsJsonAsync(
            $"{route}/{next.Id}/publish", new SharedVersion(next.Version)));
        Assert.Equal("Published", nextPublished.Status);
    }
}
