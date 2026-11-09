using System.Net;
using System.Net.Http.Json;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private async Task<ConfigurationCopy> CopySource(HttpClient owner, Guid source, Guid target)
    {
        var room = await Published(owner, "room-type-templates");
        var route = $"/api/v1/shared-configuration/room-type-templates/{room.Id}";
        var apply = new SharedApply(source, room.Version); var preview = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", apply));
        await Read<SharedOperation>(await Keyed(owner, route + "/apply", apply with { TargetState = preview.TargetState }, Guid.NewGuid()));
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates", new AssetTemplateWrite(source, "Synthetic package", [new(Guid.NewGuid(), "Synthetic chair", "Furniture", "Serialized", 2)])));
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(source, "Synthetic copy policy", "Source content", Today)));
        var fee = await owner.PostAsJsonAsync("/api/v1/billing-policies", new PolicyWrite(source, null, BHome.Domain.PropertyManagement.ChargeCategory.Rent, "RENT", "Synthetic rent", BHome.Domain.PropertyManagement.ChargingMethod.FixedPerRoomPerMonth, 12345.0001m, Today, null));
        Assert.True(fee.IsSuccessStatusCode, await fee.Content.ReadAsStringAsync());
        return new(source, target, ["RoomDefaults", "AssetTemplates", "FeePolicies", "OperatingPolicies"], Today);
    }
    [CompactPostgresFact]
    public async Task ConfigurationCopyCreatesIndependentConfigurationAndDurableReplay()
    {
        var source = await Seed(); var target = await Seed(); using var owner = await Client(source.Owner); using var staff = await Client(source.Staff);
        var input = await CopySource(owner, source.Location, target.Location);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input)).StatusCode);
        var plan = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input)); Assert.True(plan.CanProceed); Assert.Equal(4, plan.Changes.Length);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); var local = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        Assert.Empty(await local.ListAsync(target.Location, "RoomDefaults", default)); Assert.False(await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AnyAsync(p => p.LocationId == target.Location));
        input = input with { SourceState = plan.SourceState, TargetState = plan.TargetState }; var key = Guid.NewGuid();
        var result = await Read<SharedOperation>(await Keyed(owner, "/api/v1/location-configuration/copy", input, key)); Assert.Equal(4, result.CreatedReferences.Length);
        Assert.Equal(result.Id, (await Read<SharedOperation>(await Keyed(owner, "/api/v1/location-configuration/copy", input, key))).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, "/api/v1/location-configuration/copy", input with { Groups = ["RoomDefaults"] }, key)).StatusCode);
        var copied = Assert.Single(await local.ListAsync(target.Location, "OperatingPolicy", default)); var original = Assert.Single(await local.ListAsync(source.Location, "OperatingPolicy", default));
        Assert.NotEqual(original.Id, copied.Id); Assert.Equal("Draft", copied.Status);
        await owner.PutAsJsonAsync($"/api/v1/operating-policies/{original.Id}/draft", new OperatingPolicyWrite(source.Location, "Synthetic copy policy", "Changed source", Today, original.Version));
        Assert.Equal("Source content", (await local.GetAsync(copied.Id, "OperatingPolicy", default))!.Data.GetProperty("content").GetString());
        Assert.False((await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input))).CanProceed);
        Assert.Equal(12345.0001m, (await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().SingleAsync(p => p.LocationId == target.Location)).Rate);
        Assert.Equal(1, await db.Set<BHome.Domain.PropertyManagement.Room>().CountAsync(r => r.LocationId == target.Location));
        Assert.False(await db.Set<BHome.Domain.PropertyManagement.Asset>().AnyAsync(a => a.LocationId == target.Location));
        Assert.False(await db.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(c => c.Room.LocationId == target.Location));
    }
    [CompactPostgresFact]
    public async Task ConfigurationCopyRejectsStaleStateUnsupportedReferencesAndInvalidSelections()
    {
        var source = await Seed(); var target = await Seed(); using var owner = await Client(source.Owner); var input = await CopySource(owner, source.Location, target.Location);
        foreach (var invalid in new[] { input with { TargetLocationId = source.Location }, input with { Groups = ["PhysicalAssets"] }, input with { Groups = [] }, input with { ConflictStrategy = "Merge" }, input with { EffectiveFrom = null } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input with { TargetLocationId = Guid.NewGuid() })).StatusCode);
        var plan = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input));
        await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(target.Location, "Target changed", "Synthetic", Today));
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, "/api/v1/location-configuration/copy", input with { SourceState = plan.SourceState, TargetState = plan.TargetState }, Guid.NewGuid())).StatusCode);
        await owner.PostAsJsonAsync("/api/v1/billing-policies", new PolicyWrite(source.Location, source.Room, BHome.Domain.PropertyManagement.ChargeCategory.ServiceFee, "SYNTHETIC", "Room fee", BHome.Domain.PropertyManagement.ChargingMethod.FixedPerRoomPerMonth, 1, Today, null));
        plan = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input));
        Assert.False(plan.CanProceed); Assert.Contains(plan.UnsupportedReferences, x => x.Contains("Room mapping"));
    }
    [CompactPostgresFact]
    public async Task ConfigurationCopyRollsBackAllGroupsWhenDurableProvenanceFails()
    {
        var source = await Seed(); var target = await Seed(); using var owner = await Client(source.Owner); var input = await CopySource(owner, source.Location, target.Location);
        var plan = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input));
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var suffix = Guid.NewGuid().ToString("N"); var name = "test_copy_failure_" + suffix;
        var create = $"CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.location_id = ''{target.Location}''::uuid AND NEW.task_data->>''recordType''=''SharedConfigurationOperation'' THEN RAISE EXCEPTION ''Synthetic late copy failure''; END IF; RETURN NEW; END'; CREATE TRIGGER {name} BEFORE INSERT ON operational_tasks FOR EACH ROW EXECUTE FUNCTION {name}();";
        await db.Database.ExecuteSqlRawAsync(create);
        try
        {
            var response = await Keyed(owner, "/api/v1/location-configuration/copy", input with { SourceState = plan.SourceState, TargetState = plan.TargetState }, Guid.NewGuid());
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            foreach (var kind in new[] { "RoomDefaults", "AssetTemplate", "OperatingPolicy" }) Assert.Empty(await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().ListAsync(target.Location, kind, default));
            Assert.False(await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AnyAsync(p => p.LocationId == target.Location));
        }
        finally { var drop = $"DROP TRIGGER {name} ON operational_tasks; DROP FUNCTION {name}();"; await db.Database.ExecuteSqlRawAsync(drop); }
    }
}
