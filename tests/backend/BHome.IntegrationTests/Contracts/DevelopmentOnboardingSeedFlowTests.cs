using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Development;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    // This uses ONLY Compact24Fixture's randomly named, disposable loopback
    // PostgreSQL database. Without explicit BHOME_COMPACT24_TEST_ADMIN consent
    // CompactPostgresFact skips and no database is accessed or created.
    [CompactPostgresFact]
    public async Task DevelopmentOnboardingSeedCreatesConfiguredPhysicalInventoryAndReplaysWithoutDuplicateAssets()
    {
        var w = await Seed();
        var outside = await Seed();
        using var host = Host().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["AnonymousSigning:PublicSigningUrl"] = "https://localhost:5173/contract-signing",
                    ["Email:Enabled"] = "false",
                    ["DevelopmentContractSeed:Enabled"] = "true",
                    ["DevelopmentContractSeed:TenantPassword"] = "Synthetic!DevSeed-493",
                    ["IdentityProtection:ActiveEncryptionVersion"] = "synthetic-seed",
                    ["IdentityProtection:ActiveHmacVersion"] = "synthetic-seed",
                    ["IdentityProtection:EncryptionKeys:synthetic-seed"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
                    ["IdentityProtection:HmacKeys:synthetic-seed"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
                }));
        });
        using var staff = await Client(w.Staff, host);
        using var stranger = await Client(outside.Staff, host);
        using var tenant = await Client(w.Tenant, host);
        const string endpoint = "/api/v1/development/onboarding-seed";
        var key = Guid.NewGuid();

        async Task<HttpResponseMessage> Send(HttpClient client, Guid location, Guid requestKey)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = JsonContent.Create(new DevelopmentOnboardingSeedInput(location))
            };
            request.Headers.Add("Idempotency-Key", requestKey.ToString());
            return await client.SendAsync(request);
        }

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(tenant, w.Location, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(stranger, w.Location, Guid.NewGuid())).StatusCode);

        var created = await Read<DevelopmentOnboardingSeedResult>(await Send(staff, w.Location, key));
        Assert.True(created.DevelopmentOnly);
        Assert.Equal(2, created.InitialMeterTasks);
        Assert.StartsWith("TEST-", created.RoomNumber);
        Assert.Equal(created.ContractId, (await Read<DevelopmentOnboardingSeedResult>(await Send(staff, w.Location, key))).ContractId);

        var draft = await staff.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{created.ContractId}/handover/draft");
        Assert.NotNull(draft);
        // The Staff sees one move-in work card. Its required pre-handover
        // inventory checkpoint is embedded in the Assets section.
        Assert.NotNull(draft.MoveInTask);
        Assert.NotNull(draft.MoveInTask.InventoryTaskId);
        Assert.Equal("Assigned", draft.MoveInTask.InventoryStatus);
        var workPage = await staff.GetFromJsonAsync<TaskPage<TaskView>>(
            $"/api/v1/operational-tasks?locationId={w.Location}&page=1&pageSize=100");
        Assert.NotNull(workPage);
        var visibleMoveIn = Assert.Single(workPage.Items, item => item.Target?.ContractId == created.ContractId);
        Assert.Equal("AdHoc", visibleMoveIn.Kind);
        Assert.DoesNotContain(workPage.Items, item =>
            item.Target?.ContractId == created.ContractId && item.Kind == "MoveInInventory");
        async Task<HttpResponseMessage> StartWork(Guid taskId, int version)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"/api/v1/operational-tasks/{taskId}/start")
            {
                Content = JsonContent.Create(new TaskAction(version))
            };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            return await staff.SendAsync(request);
        }
        using (var refused = await StartWork(draft.MoveInTask.InventoryTaskId!.Value, 1))
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        using (var started = await StartWork(draft.MoveInTask.Id, draft.MoveInTask.Version))
            Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        using (var inventoryStarted = await StartWork(draft.MoveInTask.InventoryTaskId!.Value, 1))
            Assert.Equal(HttpStatusCode.OK, inventoryStarted.StatusCode);
        Assert.Equal(DevelopmentOnboardingSeedService.SampleInventory.Length, draft.Assets.Length);
        Assert.False(draft.NoAssetsConfirmed);
        Assert.All(draft.Assets, asset =>
        {
            Assert.NotNull(asset.ConfigurationItemId);
            Assert.Equal(asset.ConfiguredQuantity, Assert.Single(asset.PhysicalAssets!).Quantity);
            Assert.True(asset.OwnerChecked);
            Assert.Empty(asset.EvidenceIds ?? []);
        });
        // New onboarding uses the canonical, separate inventory checkpoint.
        // The absent completed inventory is surfaced as move_in_inventory,
        // not the legacy draft.assets array.
        Assert.Contains("move_in_inventory", draft.Missing);

        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var physical = await db.Set<Asset>().Where(a => a.RoomId == created.RoomId).ToArrayAsync();
        Assert.Equal(DevelopmentOnboardingSeedService.SampleInventory.Length, physical.Length);
        Assert.All(physical, asset =>
        {
            Assert.Equal(w.Location, asset.LocationId);
            Assert.Equal(AssetStatus.Active, asset.Status);
        });
        var metadata = await store.AssetMetadataAsync(physical.Select(a => a.Id).ToArray(), default);
        Assert.Equal(physical.Length, metadata.Count);
        Assert.Contains(metadata.Values, m => m.TrackingMode == "BulkQuantity" && m.Quantity == 2);
        var template = Assert.Single(await store.ListAsync(w.Location, "AssetTemplate", default));
        Assert.Single(await store.ListAsync(w.Location, "AssetTemplateAssignment", default),
            d => d.Data.GetProperty("templateId").GetGuid() == template.Id);
        Assert.Equal(physical.Length, (await store.ListAsync(w.Location, "AssetVerification", default))
            .Count(d => d.Data.GetProperty("roomId").GetGuid() == created.RoomId));
        Assert.Single(await store.ListAsync(w.Location, "DesiredAssets", default),
            d => d.Data.GetProperty("roomId").GetGuid() == created.RoomId);
    }
}
