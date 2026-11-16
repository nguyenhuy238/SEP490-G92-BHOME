using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.PropertyManagement;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private static AssetLifecyclePolicyWrite LifecyclePolicy() => new("Synthetic owner checklist", "FireSafetyEquipment", true,
        30, null, false, true, [new("position", "Check position", true)], "OwnerPolicy", "Synthetic test policy", null, null, Today);

    [CompactPostgresFact]
    public async Task LifecyclePolicyIsImmutableAndEquipmentQuantityPreservesHistory()
    {
        var w = await Seed(); var other = await Seed();
        using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); using var stranger = await Client(other.Staff);
        var policyRoute = $"/api/v1/locations/{w.Location}/asset-lifecycle-policies/{Guid.NewGuid()}";
        var policy = await Read<SetupDocument>(await owner.PutAsJsonAsync(policyRoute, LifecyclePolicy()));
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsJsonAsync(policyRoute, LifecyclePolicy())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(policyRoute, LifecyclePolicy() with { InspectionIntervalDays = 0 })).StatusCode);
        var published = await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/asset-lifecycle-policies/{policy.Id}/publish", new TemplatePublish(policy.Version)));
        Assert.Equal("Published", published.Status);
        var copyInput = new ConfigurationCopy(w.Location, other.Location, ["AssetLifecyclePolicies"]);
        var preview = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", copyInput));
        Assert.True(preview.CanProceed);
        var copied = await Read<SharedOperation>(await Keyed(owner, "/api/v1/location-configuration/copy",
            copyInput with { SourceState = preview.SourceState, TargetState = preview.TargetState }, Guid.NewGuid()));
        Assert.Single(copied.CreatedReferences);
        var copiedPolicies = (await owner.GetFromJsonAsync<SetupPage>($"/api/v1/locations/{other.Location}/asset-lifecycle-policies"))!;
        Assert.Equal("Draft", Assert.Single(copiedPolicies.Items).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(policyRoute, LifecyclePolicy() with { ExpectedVersion = published.Version })).StatusCode);
        var asset = await Read<AssetDto>(await owner.PostAsJsonAsync("/api/v1/assets", new AssetWrite(w.Location, null, "Lobby", "SYN-FIRE", "Synthetic extinguisher", "FireSafetyEquipment", "Unassessed", InitialTrackingMode: "BulkQuantity", InitialQuantity: 4)));
        var ids = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();
        var input = new EquipmentUnitWrite("Synthetic unit", null, null, null, null, Today, "Lobby", "InService", null, null, null);
        foreach (var id in ids) await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{id}", input));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{Guid.NewGuid()}", input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/assets/{asset.Id}/equipment-units")).StatusCode);
        var units = (await staff.GetFromJsonAsync<SetupPage>($"/api/v1/assets/{asset.Id}/equipment-units?pageSize=2"))!;
        Assert.Equal(4, units.TotalCount); Assert.Equal(2, units.Items.Count);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{ids[0]}", input with { Status = "Unsafe", ExpectedVersion = 1 }));
        var summary = (await owner.GetFromJsonAsync<AssetLifecycleSummary>($"/api/v1/assets/{asset.Id}/lifecycle-summary"))!;
        Assert.Equal(4, summary.Quantity); Assert.Equal(1, summary.FailedUnits);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{ids[0]}", input with { Status = "Retired", RetiredOn = Today, RetirementReason = "Synthetic replacement", ExpectedVersion = 2 }));
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{Guid.NewGuid()}", input with { ReplacesUnitId = ids[0] }));
        summary = (await owner.GetFromJsonAsync<AssetLifecycleSummary>($"/api/v1/assets/{asset.Id}/lifecycle-summary"))!;
        Assert.Equal(4, summary.ActiveUnits); Assert.Equal(5, summary.RecordedUnits); Assert.Equal(1, summary.RetiredUnits);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        Assert.Equal(3, (await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().HistoryAsync(ids[0], "AssetEquipmentUnit", default)).Count);
    }

    [CompactPostgresFact]
    public async Task LocationLegalRecordsKeepPrivateFilesAndVersionsAndRejectStaleWrites()
    {
        var w = await Seed(); var storage = new Files(); using var host = Host(storage);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = Guid.NewGuid(); var route = $"/api/v1/locations/{w.Location}/legal-records/{id}";
        MultipartFormDataContent Form(int version, string? expiry = null)
        {
            var form = new MultipartFormDataContent();
            foreach (var (key, value) in new[] { ("documentType", "FireSafety"), ("name", "Synthetic record"), ("issuedOn", "2026-01-01"), ("status", "Active"), ("expectedVersion", version.ToString()) }) form.Add(new StringContent(value), key);
            if (expiry is not null) form.Add(new StringContent(expiry), "expiresOn");
            var file = new ByteArrayContent("%PDF-1.7\nSynthetic fixture\n%%EOF"u8.ToArray()); file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(file, "file", "fixture.pdf"); return form;
        }
        using (var form = Form(0, "2025-12-31")) Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsync(route, form)).StatusCode);
        using (var form = Form(0)) await Read<SetupDocument>(await owner.PutAsync(route, form));
        using (var form = Form(1, "2027-01-01")) await Read<SetupDocument>(await owner.PutAsync(route, form));
        using (var form = Form(1)) Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsync(route, form)).StatusCode);
        var versions = (await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/location-legal-records/{id}/versions"))!;
        Assert.Equal(2, versions.Length);
        Assert.Null(versions[0].Data.GetProperty("details").GetProperty("expiresOn").GetString());
        foreach (var version in versions)
        {
            var path = $"/api/v1/location-legal-records/{id}/versions/{version.Version}/file";
            Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        }
    }
}
