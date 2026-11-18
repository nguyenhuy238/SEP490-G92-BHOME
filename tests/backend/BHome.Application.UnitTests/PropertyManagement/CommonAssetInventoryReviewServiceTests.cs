using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class CommonAssetInventoryReviewServiceTests
{
    private sealed class World
    {
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        private readonly Dictionary<Guid, SetupDocument> documents = new();
        private readonly ISetupWorkspaceStore store = Substitute.For<ISetupWorkspaceStore>();
        private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
        public readonly Location Location = new("Synthetic common inventory")
        {
            Address = "Synthetic address",
            IsActive = true
        };
        public readonly List<Asset> Assets = [];
        public readonly Dictionary<Guid, AssetMetadata> Metadata = [];
        public readonly CommonAssetInventoryReviewService Service;

        public World(bool owner = true)
        {
            user.UserId.Returns(Guid.NewGuid());
            user.IsInRole(Roles.Owner).Returns(owner);
            var access = new ResourceAccess(user, Substitute.For<IStaffLocationAccess>());
            var repository = Substitute.For<IPropertyRepository>();
            repository.FindAsync<Location>(Location.Id, Arg.Any<CancellationToken>()).Returns(Location);
            var properties = new PropertyService(repository, user, new PermissionAccess(user, access), TimeProvider.System);
            Service = new(store, user, access, properties);

            store.GetAsync(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(call => documents.GetValueOrDefault(call.ArgAt<Guid>(0)));
            store.ListAsync(Location.Id, Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(call => documents.Values.Where(doc => doc.Kind == call.ArgAt<string>(1)).OrderBy(doc => doc.Id).ToArray());
            store.ReviewCommonAssetsAsync(Location.Id, Arg.Any<CancellationToken>())
                .Returns(_ => Assets.OrderBy(asset => asset.Id)
                    .Select(asset => new RoomInventoryPhysicalAsset(asset, Metadata[asset.Id])).ToArray());
            store.EvidenceDocumentsAsync(Location.Id, Arg.Any<Guid[]>(), Arg.Any<CancellationToken>())
                .Returns(call => documents.Values.Where(doc => doc.Kind == "Evidence" &&
                    call.ArgAt<Guid[]>(1).Contains(doc.Id)).ToArray());
            store.TransactionAsync(Location.Id, Arg.Any<Func<Task<bool>>>(), Arg.Any<CancellationToken>())
                .Returns(call => call.ArgAt<Func<Task<bool>>>(1)());
            store.SaveInventoryAssetsAsync(Location.Id, Arg.Any<IReadOnlyList<AssetInventoryCreation>>(),
                Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(call =>
                {
                    foreach (var created in call.ArgAt<IReadOnlyList<AssetInventoryCreation>>(1))
                    {
                        Assets.Add(created.Asset);
                        Metadata[created.Asset.Id] = created.Metadata;
                    }
                    return Task.CompletedTask;
                });
            store.SaveAssetMetadataAsync(Arg.Any<Guid>(), Arg.Any<AssetMetadata>(), Arg.Any<CancellationToken>())
                .Returns(call =>
                {
                    Metadata[call.ArgAt<Guid>(0)] = call.ArgAt<AssetMetadata>(1);
                    return Task.CompletedTask;
                });
            store.SaveBatchAsync(Location.Id, Arg.Any<IReadOnlyList<SetupDocumentWrite>>(),
                Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(call =>
                {
                    var saved = new List<SetupDocument>();
                    foreach (var write in call.ArgAt<IReadOnlyList<SetupDocumentWrite>>(1))
                    {
                        var previous = documents.GetValueOrDefault(write.Id);
                        if ((previous?.Version ?? 0) != write.ExpectedVersion)
                            throw new PropertyException(409, "stale_version");
                        var doc = new SetupDocument(write.Id, Location.Id, write.Kind, write.Status,
                            write.ExpectedVersion + 1, JsonSerializer.SerializeToElement(write.Data, Json),
                            DateTimeOffset.UtcNow, call.ArgAt<Guid>(2));
                        documents[doc.Id] = doc;
                        saved.Add(doc);
                    }
                    return (IReadOnlyList<SetupDocument>)saved;
                });
        }

        private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
        public static SetupCommonAssetRequirement Item(string name = "Camera", int quantity = 2) =>
            new(Guid.NewGuid(), name, "Technology", "BulkQuantity", quantity, "Lobby", "Cái");
        public void Configure(params SetupCommonAssetRequirement[] items)
        {
            var id = Key($"location-common-assets:{Location.Id}");
            documents[id] = new(id, Location.Id, "CommonAssetRequirements", "Recorded", 1,
                JsonSerializer.SerializeToElement(new { items }, Json));
        }
        public Asset Physical(SetupCommonAssetRequirement item, int? quantity = null)
        {
            var asset = new Asset
            {
                LocationId = Location.Id,
                CommonArea = item.CommonArea,
                RoomId = null,
                Name = item.Name,
                Category = item.Category,
                Code = $"AS-{Guid.NewGuid():N}",
                Condition = "Hoạt động tốt",
                Status = AssetStatus.Active
            };
            Assets.Add(asset);
            Metadata[asset.Id] = new("BulkQuantity", quantity ?? item.Quantity, null, null, null, item.Unit);
            return asset;
        }
        public Guid Evidence()
        {
            var id = Guid.NewGuid();
            documents[id] = new(id, Location.Id, "Evidence", "Recorded", 1,
                JsonSerializer.SerializeToElement(new
                {
                    objectKey = $"setup/{Location.Id:N}/evidence/{id:N}",
                    hash = new string('A', 64),
                    contentType = "image/jpeg",
                    length = 1000
                }, Json));
            return id;
        }
        public SetupDocument Verification(SetupCommonAssetRequirement item) =>
            documents[Key($"common-asset-inventory-verification:{Location.Id:N}:{item.Id:N}")];
        public SetupDocument MetadataDocument(Guid assetId) => documents[assetId];
        public Task<CommonAssetInventoryView> Read() => Service.GetAsync(Location.Id, default);
        public Task<CommonAssetInventoryView> Confirm(CommonAssetInventoryConfirm input) =>
            Service.ConfirmAsync(Location.Id, input, default);
        public static CommonAssetInventoryConfirm Command(CommonAssetInventoryView view,
            params CommonAssetInventoryInputItem[] items) => new(Guid.NewGuid(), view.RequirementsId!.Value,
                view.RequirementsVersion, view.StateToken, items, true);
    }

    [Fact]
    public async Task ReferencePriceIsSuggestionOnlyAndOwnerCostIsImmutableOnRecheck()
    {
        var world = new World();
        var camera = World.Item() with { ReferencePrice = 2_000_000m };
        world.Configure(camera);
        var initial = await world.Read();
        Assert.Equal(2_000_000m, Assert.Single(initial.Items).ReferenceUnitCost);
        var first = World.Command(initial, new CommonAssetInventoryInputItem(camera.Id, true, [], 1_750_000m));
        var confirmed = await world.Confirm(first);
        var asset = Assert.Single(world.Assets);
        Assert.Equal(1_750_000m, world.Metadata[asset.Id].PurchaseCost);
        Assert.Equal(1_750_000m, world.MetadataDocument(asset.Id).Data.GetProperty("purchaseCost").GetDecimal());
        Assert.Equal(1_750_000m, Assert.Single(confirmed.Items).AcquisitionUnitCost);
        var snapshotVersion = world.MetadataDocument(asset.Id).Version;
        await world.Confirm(first);
        Assert.Equal(snapshotVersion, world.MetadataDocument(asset.Id).Version);
        Assert.Single(world.Assets);

        Assert.Equal("asset_acquisition_price_locked",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(World.Command(confirmed,
                new CommonAssetInventoryInputItem(camera.Id, true, [], 1_900_000m))))).Code);
        Assert.Equal(1_750_000m, world.Metadata[asset.Id].PurchaseCost);
    }

    [Fact]
    public async Task LegacyVerifiedUnpricedCommonCanRecordExplicitZeroWithoutDuplication()
    {
        var world = new World();
        var camera = World.Item();
        world.Configure(camera);
        var existing = world.Physical(camera);
        var before = await world.Read();
        var confirmed = await world.Confirm(World.Command(before,
            new CommonAssetInventoryInputItem(camera.Id, true, [], 0m)));
        Assert.Equal("Matched", confirmed.State);
        Assert.Single(world.Assets);
        Assert.Equal(existing.Id, world.Assets[0].Id);
        Assert.Equal(0m, world.Metadata[existing.Id].PurchaseCost);
        Assert.Equal(0m, world.MetadataDocument(existing.Id).Data.GetProperty("purchaseCost").GetDecimal());
    }

    [Fact]
    public async Task PartialConfirmationPersistsOnlyCheckedPhysicalGroupsAndReplaysSafely()
    {
        var world = new World();
        var camera = World.Item();
        var broom = World.Item("Broom", 3);
        world.Configure(camera, broom);
        var initial = await world.Read();
        var evidence = world.Evidence();
        var first = World.Command(initial, new CommonAssetInventoryInputItem(camera.Id, true, [evidence]),
            new CommonAssetInventoryInputItem(broom.Id, false, []));

        var partial = await world.Confirm(first);
        Assert.Equal("PartiallyChecked", partial.State);
        Assert.Equal(1, partial.CheckedCount);
        Assert.Single(world.Assets);
        Assert.Null(world.Assets[0].RoomId);
        Assert.Equal("Lobby", world.Assets[0].CommonArea);
        Assert.Equal(2, world.Metadata[world.Assets[0].Id].Quantity);
        Assert.Equal("Verified", world.Verification(camera).Status);
        Assert.Equal("Missing", world.Verification(broom).Status);
        Assert.Single(partial.Items.Single(item => item.Id == camera.Id).Evidence);

        await world.Confirm(first);
        Assert.Single(world.Assets);

        var completed = await world.Confirm(World.Command(partial,
            new CommonAssetInventoryInputItem(camera.Id, true, [evidence]),
            new CommonAssetInventoryInputItem(broom.Id, true, [])));
        Assert.Equal("Matched", completed.State);
        Assert.Equal(2, world.Assets.Count);
    }

    [Fact]
    public async Task ExistingAssetIsLinkedAndMissingReviewDoesNotDeleteIt()
    {
        var world = new World();
        var camera = World.Item();
        world.Configure(camera);
        var physical = world.Physical(camera);
        var initial = await world.Read();
        var verified = await world.Confirm(World.Command(initial,
            new CommonAssetInventoryInputItem(camera.Id, true, [])));
        Assert.Equal("Matched", verified.State);
        Assert.Single(world.Assets);
        Assert.Equal(physical.Id, world.Verification(camera).Data.GetProperty("assetId").GetGuid());

        var missing = await world.Confirm(World.Command(verified,
            new CommonAssetInventoryInputItem(camera.Id, false, [])));
        Assert.Equal("PartiallyChecked", missing.State);
        Assert.False(Assert.Single(missing.Items).Checked);
        Assert.Equal("Missing", world.Verification(camera).Status);
        Assert.Single(world.Assets);

        var restored = await world.Confirm(World.Command(missing,
            new CommonAssetInventoryInputItem(camera.Id, true, [])));
        Assert.Equal("Matched", restored.State);
        Assert.Single(world.Assets);
    }

    [Fact]
    public async Task StaleSnapshotAndAmbiguousExistingAssetsAreRejected()
    {
        var world = new World();
        var camera = World.Item();
        world.Configure(camera);
        var stale = await world.Read();
        var physical = world.Physical(camera);
        Assert.Equal("inventory_review_state_changed",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(
                World.Command(stale, new CommonAssetInventoryInputItem(camera.Id, true, []))))).Code);
        world.Physical(camera);
        var ambiguous = await world.Read();
        Assert.Equal("NeedsReview", ambiguous.State);
        Assert.Equal("common_asset_mismatch", Assert.Single(ambiguous.Items).BlockedReason);
        Assert.Equal("common_asset_mismatch",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(
                World.Command(ambiguous, new CommonAssetInventoryInputItem(camera.Id, true, []))))).Code);
        Assert.Equal(2, world.Assets.Count);
        Assert.Contains(world.Assets, asset => asset.Id == physical.Id);
    }

    [Fact]
    public async Task EvidenceOverLimitAndCrossRoleAccessAreRejected()
    {
        var world = new World();
        var camera = World.Item();
        world.Configure(camera);
        var view = await world.Read();
        var tooMany = Enumerable.Range(0, 6).Select(_ => world.Evidence()).ToArray();
        Assert.Equal("invalid_common_asset_inventory_review",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(
                World.Command(view, new CommonAssetInventoryInputItem(camera.Id, true, tooMany))))).Code);
        Assert.Empty(world.Assets);
        var staff = new World(owner: false);
        Assert.Equal("owner_required",
            (await Assert.ThrowsAsync<PropertyException>(() => staff.Read())).Code);
    }
}
