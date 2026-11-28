using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Development;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task OwnerQuickCreateUsesExistingRoomAndRealConfigurationWithoutDuplicateContract()
    {
        var w = await Seed();
        var outside = await Seed();
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            db.AddRange(
                new BillingPolicy { LocationId = w.Location, ChargeCode = "RENT", Name = "Rent", Category = ChargeCategory.Rent, Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3200000, EffectiveFrom = Today.AddDays(-1) },
                new BillingPolicy { LocationId = w.Location, ChargeCode = "ELECTRICITY", Name = "Electricity", Category = ChargeCategory.Electricity, Method = ChargingMethod.Metered, Rate = 3500, EffectiveFrom = Today.AddDays(-1) },
                new BillingPolicy { LocationId = w.Location, ChargeCode = "WATER", Name = "Water", Category = ChargeCategory.Water, Method = ChargingMethod.Metered, Rate = 20000, EffectiveFrom = Today.AddDays(-1) });
            db.AddRange(new[] { UtilityType.Electricity, UtilityType.Water }.Select(type => new Meter
            {
                RoomId = w.Room,
                Code = $"TEST-{type}-{Guid.NewGuid():N}",
                UtilityType = type,
                Display = MeterDisplay.Mechanical,
                InstalledOn = Today.AddDays(-1)
            }));
            await db.SaveChangesAsync();
        }
        using var host = Host().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services => services.AddScoped<DevelopmentOnboardingSeedService>());
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
        using var owner = await Client(w.Owner, host);
        using var staff = await Client(w.Staff, host);
        using var tenant = await Client(w.Tenant, host);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsJsonAsync("/api/v1/development/onboarding-seed", new { locationId = w.Location, roomId = w.Room })).StatusCode);
        const string endpoint = "/test-probe/onboarding-seed";
        var key = Guid.NewGuid();

        async Task<HttpResponseMessage> Send(HttpClient client, Guid location, Guid room, Guid requestKey)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = JsonContent.Create(new DevelopmentOnboardingSeedInput(location, room))
            };
            request.Headers.Add("Idempotency-Key", requestKey.ToString());
            return await client.SendAsync(request);
        }

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(tenant, w.Location, w.Room, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(staff, w.Location, w.Room, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner, outside.Location, w.Room, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, outside.Location, outside.Room, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, w.Location, w.Room, key)).StatusCode);

        var existingAsset = new Asset
        {
            LocationId = w.Location,
            RoomId = w.Room,
            Name = "Ghế kiểm thử",
            Category = "Furniture",
            Code = Guid.NewGuid().ToString("N"),
            Condition = "Tốt",
            Status = AssetStatus.Active
        };
        var configuredItem = new AssetTemplateItem(Guid.NewGuid(), existingAsset.Name, existingAsset.Category,
            "BulkQuantity", 3, "cái");
        var unprovisionedItem = new AssetTemplateItem(Guid.NewGuid(), "Bàn kiểm thử", "Furniture",
            "Serialized", 1, "cái");
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            db.Add(existingAsset);
            await db.SaveChangesAsync();
            await store.SaveAssetMetadataAsync(existingAsset.Id, new("BulkQuantity", 3, null, null, null, "cái"), default);
            var template = Guid.NewGuid();
            AssetTemplateItem[] items = [configuredItem, unprovisionedItem];
            await store.SaveAsync(template, w.Location, "AssetTemplate", "Published",
                new AssetTemplateWrite(w.Location, "Synthetic room template", items, Scoped: true, ScopeRoomId: w.Room), 0, w.Owner.Id, default);
            await store.SaveAsync(HandoverTestKey($"asset-template-assignment:{w.Room}"), w.Location,
                "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(template), 0, w.Owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), w.Location, "DesiredAssets", "PendingVerification",
                new DesiredAssets(template, 1, w.Room, items, "PendingVerification"), 0, w.Owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), w.Location, "AssetVerification", "Verified", new
            {
                roomId = w.Room,
                templateId = template,
                itemId = configuredItem.Id,
                assetId = existingAsset.Id,
                quantity = 3,
                evidenceIds = Array.Empty<Guid>(),
                source = "OwnerAttestation"
            }, 0, w.Owner.Id, default);
        }

        var created = await Read<DevelopmentOnboardingSeedResult>(await Send(owner, w.Location, w.Room, key));
        Assert.True(created.DevelopmentOnly);
        Assert.Equal(w.Room, created.RoomId);
        Assert.Equal("S101", created.RoomNumber);
        Assert.NotNull(created.TenantPassword);
        var replay = await Read<DevelopmentOnboardingSeedResult>(await Send(owner, w.Location, w.Room, key));
        Assert.Equal(created.ContractId, replay.ContractId);
        Assert.Null(replay.TenantPassword);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, w.Location, w.Room, Guid.NewGuid())).StatusCode);

        var draft = await staff.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{created.ContractId}/handover/draft");
        Assert.NotNull(draft);
        Assert.NotNull(draft.MoveInTask);
        Assert.NotNull(draft.MoveInTask.InventoryTaskId);
        Assert.Equal(2, draft.Assets.Length);
        var draftAsset = Assert.Single(draft.Assets, asset => asset.ConfigurationItemId == configuredItem.Id);
        Assert.Equal(existingAsset.Id, Assert.Single(draftAsset.PhysicalAssets!).Id);
        Assert.Equal(3, Assert.Single(draftAsset.PhysicalAssets!).Quantity);
        Assert.False(draftAsset.Checked);
        Assert.False(draft.NoAssetsConfirmed);
        var unprovisionedDraft = Assert.Single(draft.Assets, asset => asset.ConfigurationItemId == unprovisionedItem.Id);
        Assert.Empty(unprovisionedDraft.PhysicalAssets!);
        Assert.Equal(1, unprovisionedDraft.ConfiguredQuantity);
        var workPage = await staff.GetFromJsonAsync<TaskPage<TaskView>>(
            $"/api/v1/operational-tasks?locationId={w.Location}&page=1&pageSize=100");
        Assert.NotNull(workPage);
        Assert.Contains(workPage.Items, item => item.Target?.ContractId == created.ContractId && item.Kind == "AdHoc");

        await using var check = host.Services.CreateAsyncScope();
        var stored = check.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Equal(1, await stored.Set<Room>().CountAsync(room => room.LocationId == w.Location));
        Assert.Equal(RoomStatus.Occupied, (await stored.Set<Room>().SingleAsync(room => room.Id == w.Room)).Status);
        var contract = await stored.Set<Contract>().SingleAsync(c => c.Id == created.ContractId);
        Assert.Equal(w.Owner.Id, contract.OwnerSignerId);
        Assert.Equal(ContractStatus.Active, contract.Status);
        Assert.Equal(3200000m, contract.RentAmount);
        Assert.Equal(0m, contract.RequiredDeposit);
        Assert.Equal(2, await stored.Set<Meter>().CountAsync(m => m.RoomId == w.Room));
        Assert.Equal(existingAsset.Id, Assert.Single(await stored.Set<Asset>().Where(a => a.RoomId == w.Room).ToArrayAsync()).Id);
        var inventoryTask = Assert.Single(await stored.Set<OperationalTask>().Where(task =>
            task.ContractId == created.ContractId && task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MoveInInventory).ToArrayAsync());
        var inventorySnapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(inventoryTask.MoveInInventoryJson)!;
        Assert.Equal(draft.InventoryToken, inventorySnapshot.SourceToken);
        Assert.Equal(2, inventorySnapshot.Items.Length);
        var inventoryItem = Assert.Single(inventorySnapshot.Items, item => item.Id == configuredItem.Id);
        Assert.Equal(existingAsset.Id, inventoryItem.AssetId);
        Assert.Equal(3, inventoryItem.ExpectedQuantity);
        Assert.Null(inventoryItem.ActualQuantity);
        var unprovisioned = Assert.Single(inventorySnapshot.Items, item => item.Id == unprovisionedItem.Id);
        Assert.Null(unprovisioned.AssetId);
        Assert.Equal(1, unprovisioned.ExpectedQuantity);
        Assert.Null(unprovisioned.ActualQuantity);
        var meterIds = await stored.Set<Meter>().Where(m => m.RoomId == w.Room).Select(m => m.Id).ToArrayAsync();
        Assert.Empty(await stored.Set<MeterReading>().Where(r => meterIds.Contains(r.MeterId)).ToArrayAsync());
        var baselines = await stored.Set<OperationalTask>().Where(task => task.ContractId == created.ContractId &&
            task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading).ToArrayAsync();
        Assert.Equal(2, baselines.Length);
        Assert.All(baselines, task => Assert.Equal(ReadingPurpose.Initial, task.Purpose));
    }
}
