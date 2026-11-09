using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private static async Task<HttpResponseMessage> Keyed(HttpClient client, string route, object input, Guid key)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(input) };
        request.Headers.Add("Idempotency-Key", key.ToString()); return await client.SendAsync(request);
    }
    private async Task<SharedDocument> Published(HttpClient owner, string resource)
    {
        var input = SharedInput(resource == "asset-templates" ? "asset-catalog" : resource);
        if (resource == "asset-templates")
        {
            var catalog = await Published(owner, "asset-catalog");
            input = input with { Data = JsonSerializer.SerializeToElement(new SharedAssetData([new(catalog.Id, catalog.Version, 2, true, "Serialized")])) };
        }
        var route = "/api/v1/shared-configuration/" + resource;
        var draft = await Read<SharedDocument>(await owner.PostAsJsonAsync(route, input));
        return await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/" + draft.Id + "/publish", new SharedVersion(draft.Version)));
    }
    [CompactPostgresFact] public Task SharedRoomApply() => Application("room-type-templates", "RoomDefaults");
    [CompactPostgresFact] public Task SharedAssetApply() => Application("asset-templates", "AssetTemplate");
    [CompactPostgresFact] public Task SharedFeeApply() => Application("fee-templates", "BillingPolicy");
    [CompactPostgresFact] public Task SharedPolicyApply() => Application("policy-templates", "OperatingPolicy");
    private async Task Application(string resource, string kind)
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); var doc = await Published(owner, resource);
        var route = $"/api/v1/shared-configuration/{resource}/{doc.Id}"; var input = new SharedApply(w.Location, doc.Version);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(route + "/apply-preview", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/apply-preview", input with { ExpectedVersion = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/apply-preview", input with { LocationId = Guid.NewGuid() })).StatusCode);
        var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", input)); Assert.True(plan.CanProceed);
        var usage = await owner.GetFromJsonAsync<SharedUsage>(route + "/applications"); Assert.Equal(0, usage!.Total);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.False(await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AnyAsync(p => p.LocationId == w.Location));
            Assert.Empty(await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().ListAsync(w.Location, kind, default));
        }
        var key = Guid.NewGuid(); input = input with { TargetState = plan.TargetState };
        var applied = await Read<SharedOperation>(await Keyed(owner, route + "/apply", input, key));
        Assert.Equal(applied, await Read<SharedOperation>(await Keyed(owner, route + "/apply", input, key)), SharedOperationComparer.Instance);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, route + "/apply", input with { IncludeOptionalItems = false }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, route + "/apply", input, Guid.NewGuid())).StatusCode);
        usage = await owner.GetFromJsonAsync<SharedUsage>(route + "/applications"); Assert.Equal(1, usage!.Total); Assert.Equal(1, usage.LocationsUsing);
        Assert.Equal(doc.Version, usage.Items[0].SourceVersion); Assert.Equal(w.Owner.Id, usage.Items[0].ActorId); Assert.Single(applied.CreatedReferences);
        var next = await Read<SharedDocument>(await owner.PostAsJsonAsync(route + "/versions", new SharedVersion(doc.Version)));
        await owner.PutAsJsonAsync($"/api/v1/shared-configuration/{resource}/{next.Id}", new SharedWrite(next.Name, "Source changed independently", next.Data, 1));
        await using var verify = fixture.Factory!.Services.CreateAsyncScope(); var targetDb = verify.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(1, await targetDb.Set<BHome.Domain.PropertyManagement.Room>().CountAsync(r => r.LocationId == w.Location));
        Assert.False(await targetDb.Set<BHome.Domain.PropertyManagement.Asset>().AnyAsync(a => a.LocationId == w.Location));
        if (kind == "BillingPolicy") Assert.Equal(3500000.0001m, (await targetDb.Set<BHome.Domain.PropertyManagement.BillingPolicy>().SingleAsync(p => p.LocationId == w.Location)).Rate);
        else { var target = await verify.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().GetAsync(applied.CreatedReferences[0], kind, default); Assert.NotNull(target); Assert.Equal(1, target.Version); }
    }
    private sealed class SharedOperationComparer : IEqualityComparer<SharedOperation>
    {
        public static SharedOperationComparer Instance { get; } = new();
        public bool Equals(SharedOperation? a, SharedOperation? b) => JsonSerializer.Serialize(a) == JsonSerializer.Serialize(b);
        public int GetHashCode(SharedOperation value) => value.Id.GetHashCode();
    }
    [CompactPostgresFact]
    public async Task NativeFeeWritesParticipateInSharedTransactionRollback()
    {
        var w = await Seed();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var store = scope.ServiceProvider.GetRequiredService<ISharedConfigurationStore>(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await Assert.ThrowsAsync<InvalidOperationException>(() => store.TransactionAsync<bool>([w.Location], async () =>
        {
            var repository = scope.ServiceProvider.GetRequiredService<IPropertyRepository>();
            await repository.WithLocationLockAsync(w.Location, async () => { db.Add(new BHome.Domain.PropertyManagement.BillingPolicy { LocationId = w.Location, Category = BHome.Domain.PropertyManagement.ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rollback", Rate = 1, EffectiveFrom = Today }); await db.SaveChangesAsync(); return true; }, default);
            throw new InvalidOperationException("Synthetic failure after fee persistence");
        }, default));
        db.ChangeTracker.Clear(); Assert.False(await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AnyAsync(p => p.LocationId == w.Location));
    }
    [CompactPostgresFact]
    public async Task SharedApplyRejectsChangedTargetAndUnsupportedStrategy()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var doc = await Published(owner, "policy-templates"); var route = $"/api/v1/shared-configuration/policy-templates/{doc.Id}";
        var input = new SharedApply(w.Location, doc.Version); var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", input));
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Different target policy", "Changed independently", Today)));
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, route + "/apply", input with { TargetState = plan.TargetState }, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(route + "/apply-preview", input with { ConflictStrategy = "Overwrite" })).StatusCode);
        Assert.Equal(0, (await owner.GetFromJsonAsync<SharedUsage>(route + "/applications"))!.Total);
    }
}
