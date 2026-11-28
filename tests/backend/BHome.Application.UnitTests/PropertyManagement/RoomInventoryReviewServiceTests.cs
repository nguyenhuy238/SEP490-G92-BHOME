using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.IdentityAccess;
using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class RoomInventoryReviewServiceTests
{
    private sealed class World
    {
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        private readonly Dictionary<Guid, SetupDocument> documents = new();
        private readonly List<Room> rooms = [];
        private readonly ISetupWorkspaceStore store;
        public readonly Location Location = new("Synthetic inventory") { Address = "Synthetic address", IsActive = true };
        public readonly List<Asset> Assets = [];
        public readonly Dictionary<Guid, AssetMetadata> Metadata = new();
        public Guid[] LastActiveAssetIds { get; private set; } = [];
        public readonly RoomInventoryReviewService Service;

        public World(ISharedConfigurationStore? shared = null)
        {
            store = Substitute.For<ISetupWorkspaceStore>();
            var user = Substitute.For<ICurrentUser>();
            user.UserId.Returns(Guid.NewGuid());
            user.IsInRole(Roles.Owner).Returns(true);
            var access = new ResourceAccess(user, Substitute.For<IStaffLocationAccess>());
            var repository = Substitute.For<IPropertyRepository>();
            repository.FindAsync<Location>(Location.Id, Arg.Any<CancellationToken>()).Returns(Location);
            var properties = new PropertyService(repository, user, new PermissionAccess(user, access), TimeProvider.System);
            Service = new(store, user, access, new Lazy<PropertyService>(() => properties), NullLogger<RoomInventoryReviewService>.Instance, shared);

            store.ReviewRoomsAsync(Location.Id, Arg.Any<CancellationToken>()).Returns(_ => rooms.ToArray());
            store.ReviewRoomAssetsAsync(Location.Id, Arg.Any<CancellationToken>()).Returns(_ =>
                Assets.OrderBy(a => a.Id).Select(a => new RoomInventoryPhysicalAsset(a, Metadata[a.Id])).ToArray());
            store.ReviewDocumentsAsync(Location.Id, Arg.Any<Guid[]>(), Arg.Any<CancellationToken>()).Returns(call =>
            {
                LastActiveAssetIds = call.ArgAt<Guid[]>(1);
                return documents.Values.OrderBy(d => d.Id).ToArray();
            });
            store.EvidenceDocumentsAsync(Location.Id, Arg.Any<Guid[]>(), Arg.Any<CancellationToken>()).Returns(call =>
            {
                var ids = call.ArgAt<Guid[]>(1).ToHashSet();
                return documents.Values.Where(d => ids.Contains(d.Id) && d.Kind == "Evidence").ToArray();
            });
            store.TransactionAsync(Location.Id, Arg.Any<Func<Task<RoomInventoryReviewView>>>(), Arg.Any<CancellationToken>())
                .Returns(call =>
                {
                    if (!Location.IsActive) throw new PropertyException(409, "location_inactive_or_missing");
                    return call.Arg<Func<Task<RoomInventoryReviewView>>>()();
                });
            store.GetAsync(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(call => documents.GetValueOrDefault(call.ArgAt<Guid>(0)));
            store.SaveInventoryAssetsAsync(Location.Id, Arg.Any<IReadOnlyList<AssetInventoryCreation>>(),
                Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(call =>
                {
                    foreach (var creation in call.ArgAt<IReadOnlyList<AssetInventoryCreation>>(1))
                    {
                        Assets.Add(creation.Asset);
                        Metadata[creation.Asset.Id] = creation.Metadata;
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
                    var writes = call.ArgAt<IReadOnlyList<SetupDocumentWrite>>(1);
                    var actor = call.ArgAt<Guid>(2);
                    var saved = new List<SetupDocument>();
                    foreach (var write in writes)
                    {
                        var previous = documents.GetValueOrDefault(write.Id);
                        if ((previous?.Version ?? 0) != write.ExpectedVersion ||
                            previous is not null && previous.LocationId != Location.Id)
                            throw new PropertyException(409, "stale_version");
                        var document = new SetupDocument(write.Id, Location.Id, write.Kind, write.Status,
                            write.ExpectedVersion + 1, JsonSerializer.SerializeToElement(write.Data, Json),
                            DateTimeOffset.UtcNow, actor);
                        documents[write.Id] = document;
                        saved.Add(document);
                    }
                    return (IReadOnlyList<SetupDocument>)saved;
                });
        }

        private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
        private void Add(Guid id, string kind, string status, object data) =>
            documents[id] = new(id, Location.Id, kind, status, 1, JsonSerializer.SerializeToElement(data, Json));

        public Room AddRoom(params AssetTemplateItem[]? configuredItems)
        {
            var room = new Room { LocationId = Location.Id, RoomNumber = (rooms.Count + 1).ToString(), Capacity = 2 };
            rooms.Add(room);
            store.RoomLocationAsync(room.Id, Arg.Any<CancellationToken>()).Returns(Location.Id);
            if (configuredItems is null) return room;
            var templateId = Guid.NewGuid();
            Add(templateId, "AssetTemplate", "Published",
                new AssetTemplateWrite(Location.Id, "Synthetic", configuredItems, Scoped: true));
            Add(Key($"asset-template-assignment:{room.Id}"), "AssetTemplateAssignment", "Assigned",
                new AssetTemplateAssignment(templateId));
            Add(Guid.NewGuid(), "DesiredAssets", "PendingVerification",
                new DesiredAssets(templateId, 1, room.Id, configuredItems, "PendingVerification"));
            return room;
        }

        public void ReplaceRoomRequirements(Room room, AssetTemplateItem replacement)
        {
            var template = documents.Values.Single(d => d.Kind == "AssetTemplate" &&
                Read<AssetTemplateWrite>(d).ScopeRoomId == null);
            documents[template.Id] = template with
            {
                Version = template.Version + 1,
                Data = JsonSerializer.SerializeToElement(
                    new AssetTemplateWrite(Location.Id, "Updated", [replacement], Scoped: true), Json)
            };
            Add(Guid.NewGuid(), "DesiredAssets", "PendingVerification",
                new DesiredAssets(template.Id, template.Version + 1, room.Id, [replacement], "PendingVerification"));
        }

        public static AssetTemplateItem Item(string name = "Chair", int quantity = 2) =>
            new(Guid.NewGuid(), name, "Furniture", "Serialized", quantity, "item");

        public Guid AddEvidence(Guid? location = null)
        {
            var id = Guid.NewGuid();
            documents[id] = new(id, location ?? Location.Id, "Evidence", "Recorded", 1,
                JsonSerializer.SerializeToElement(new
                {
                    objectKey = $"setup/{(location ?? Location.Id):N}/evidence/{id:N}",
                    hash = new string('A', 64),
                    contentType = "image/jpeg",
                    length = 4
                }, Json), DateTimeOffset.UtcNow, Guid.NewGuid());
            return id;
        }

        public Asset AddPhysical(Room room, AssetTemplateItem item, int quantity, string code = "SYN-ASSET")
        {
            var asset = new Asset
            {
                LocationId = Location.Id,
                RoomId = room.Id,
                Code = code,
                Name = item.Name,
                Category = item.Category,
                Condition = "Hoạt động tốt",
                Status = AssetStatus.Active
            };
            Assets.Add(asset);
            Metadata[asset.Id] = new("BulkQuantity", quantity, null, null, null, item.Unit);
            return asset;
        }

        public void AddOwnerMapping(Room room, AssetTemplateItem item, Asset asset, Guid? evidenceId = null)
        {
            var template = documents.Values.Single(d => d.Kind == "AssetTemplate" &&
                Read<AssetTemplateWrite>(d).Items.Any(i => i.Id == item.Id));
            var id = Key($"owner-attestation:{room.Id:N}:{template.Id:N}:{item.Id:N}:{asset.Id:N}");
            Add(id, "AssetVerification", "Verified", new
            {
                assetId = asset.Id,
                roomId = room.Id,
                templateId = template.Id,
                itemId = item.Id,
                quantity = Metadata[asset.Id].Quantity,
                code = asset.Code,
                condition = asset.Condition,
                trackingMode = Metadata[asset.Id].TrackingMode,
                unit = Metadata[asset.Id].Unit,
                source = "OwnerAttestation",
                evidenceIds = evidenceId is { } idWithEvidence ? new[] { idWithEvidence } : [],
                verifiedBy = Guid.NewGuid()
            });
        }

        public void AppendStaffEvidence(Guid assetId, Guid evidenceId)
        {
            var mapping = documents.Values.Single(d => d.Kind == "AssetVerification" &&
                d.Data.GetProperty("assetId").GetGuid() == assetId &&
                d.Data.GetProperty("source").GetString() == "OwnerAttestation");
            var node = JsonNode.Parse(mapping.Data.GetRawText())!.AsObject();
            node["staffEvidenceIds"] = JsonSerializer.SerializeToNode(new[] { evidenceId }, Json);
            documents[mapping.Id] = mapping with
            {
                Version = mapping.Version + 1,
                Data = JsonSerializer.SerializeToElement(node, Json),
                RecordedAt = DateTimeOffset.UtcNow,
                RecordedBy = Guid.NewGuid()
            };
        }

        private static T Read<T>(SetupDocument document) =>
            document.Data.Deserialize<T>(Json) ?? throw new InvalidOperationException();
        public Task<RoomInventoryReviewView> Read() => Service.GetAsync(Location.Id, default);
        public SetupDocument MetadataDocument(Guid assetId) => documents[assetId];
        public Task<RoomInventoryReviewView> Confirm(RoomInventoryReviewConfirm command) =>
            Service.ConfirmAsync(Location.Id, command, default);
        public static RoomInventoryReviewInputRoom Input(RoomInventoryReviewRoom room, params RoomInventoryReviewInputItem[] items) =>
            new(room.RoomId, room.DesiredId, room.DesiredVersion, room.StateToken, items);
        public static RoomInventoryReviewInputItem[] CheckedItems(RoomInventoryReviewRoom room, params Guid[] evidenceIds) =>
            room.Items.Select((item, index) => new RoomInventoryReviewInputItem(item.Id, true, [evidenceIds[index]])).ToArray();
    }

    [Fact]
    public async Task MoveInTokenIgnoresRoomVersionButStillDetectsAssetChanges()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var asset = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, asset);
        var original = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);
        Assert.NotNull(original.MoveInStateToken);

        room.Status = RoomStatus.Occupied;
        room.Version++;
        var activated = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);
        Assert.NotEqual(original.StateToken, activated.StateToken);
        Assert.Equal(original.MoveInStateToken, activated.MoveInStateToken);
        Assert.True(activated.MatchesMoveInSourceToken(original.StateToken));
        Assert.True(activated.MatchesMoveInSourceToken(original.MoveInStateToken!));

        world.Metadata[asset.Id] = world.Metadata[asset.Id] with { Quantity = 1 };
        var changed = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);
        Assert.False(changed.MatchesMoveInSourceToken(original.StateToken));
        Assert.False(changed.MatchesMoveInSourceToken(original.MoveInStateToken!));
    }

    [Fact]
    public async Task MoveInTokenStillDetectsChangedPhysicalAssetVersionAndConfiguration()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var asset = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, asset);
        var original = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);

        room.Version++;
        asset.Version++;
        var changed = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);
        Assert.False(changed.MatchesMoveInSourceToken(original.StateToken));
        Assert.False(changed.MatchesMoveInSourceToken(original.MoveInStateToken!));

        asset.Version--;
        world.ReplaceRoomRequirements(room, item with { Quantity = item.Quantity + 1 });
        var reconfigured = await world.Service.PrepareForMoveInTaskAsync(room.Id, default);
        Assert.False(reconfigured.MatchesMoveInSourceToken(original.StateToken));
        Assert.False(reconfigured.MatchesMoveInSourceToken(original.MoveInStateToken!));
    }

    [Fact]
    public async Task SnapshotFiltersVerificationDocumentsByPhysicalAssetIds()
    {
        var world = new World();
        var room = world.AddRoom(World.Item());
        var asset = world.AddPhysical(room, World.Item(), 2);
        var view = await world.Read();
        Assert.Single(view.Rooms);
        Assert.Equal(new[] { asset.Id }, world.LastActiveAssetIds);
    }

    [Fact]
    public async Task FinanceReviewCount_RejectsHistoricMatchedChecklistAfterTemplateChanges()
    {
        var world = new World();
        var room = world.AddRoom(World.Item("Chair", 2));
        var original = Assert.Single((await world.Read()).Rooms);
        var checkedItems = original.Items.Select(item =>
            new RoomInventoryReviewInputItem(item.Id, true, [])).ToArray();
        var confirmed = await world.Confirm(new(Guid.NewGuid(), [World.Input(original, checkedItems)], true));
        Assert.Equal("Matched", Assert.Single(confirmed.Rooms).State);
        Assert.Equal(0, await world.Service.CountRoomsRequiringReviewAsync(world.Location.Id, default));

        // Previous review persists as Matched, but its baseline is no longer
        // valid after new required assets are published for the same room.
        world.ReplaceRoomRequirements(room, World.Item("Desk", 1));
        Assert.NotEqual("Matched", Assert.Single((await world.Read()).Rooms).State);
        Assert.Equal(1, await world.Service.CountRoomsRequiringReviewAsync(world.Location.Id, default));
    }

    [Fact]
    public async Task NoConfigurationRemainsUnconfirmedAndDoesNotCreateAssets()
    {
        var world = new World();
        var room = world.AddRoom(null);
        var before = await world.Read();
        var row = Assert.Single(before.Rooms);
        Assert.Equal(room.Id, row.RoomId);
        Assert.Equal("NotChecked", row.State);
        Assert.Equal("no_asset_requirements", row.BlockedReason);
        Assert.Empty(row.Items);

        var confirmed = await world.Confirm(new(Guid.NewGuid(), [World.Input(row)], true));
        Assert.Equal("NotChecked", Assert.Single(confirmed.Rooms).State);
        Assert.Empty(world.Assets);
    }

    [Fact]
    public async Task PartialConfirmationAndOptionalEvidence()
    {
        var world = new World();
        world.AddRoom(World.Item("Chair"), World.Item("Desk"));
        var row = Assert.Single((await world.Read()).Rooms);
        var evidence = world.AddEvidence();
        var uncheckedCommand = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row,
                new(row.Items[0].Id, true, [evidence]),
                new(row.Items[1].Id, false, []))], true);
        var tooManyPhotos = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, new(row.Items[0].Id, true, Enumerable.Range(0, 6).Select(_ => world.AddEvidence()).ToArray()),
                new(row.Items[1].Id, true, []))], true);
        Assert.Equal("inventory_review_items_incomplete",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(tooManyPhotos))).Code);

        var nullItem = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, [null!])], true);
        Assert.Equal("invalid_inventory_review",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(nullItem))).Code);
        Assert.Empty(world.Assets);

        var partial = Assert.Single((await world.Confirm(uncheckedCommand)).Rooms);
        Assert.Equal("PartiallyChecked", partial.State);
        var reloaded = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("PartiallyChecked", reloaded.State);
        Assert.Equal(1, reloaded.CheckedCount);
        row = reloaded;
        var quickConfirm = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, row.Items.Select(item => new RoomInventoryReviewInputItem(item.Id, true, [])).ToArray())], true);
        var confirmed = Assert.Single((await world.Confirm(quickConfirm)).Rooms);
        Assert.Equal("Matched", confirmed.State);
        Assert.All(confirmed.Items, item => Assert.Empty(item.Evidence));
        Assert.Equal("Matched", Assert.Single((await world.Read()).Rooms).State);
        await world.Confirm(quickConfirm);
        Assert.Equal(2, world.Assets.Count);
    }

    [Fact]
    public async Task LegacyRoomWithoutSavedPricesPrefillsFromMatchingPublishedAssetCatalog()
    {
        var shared = Substitute.For<ISharedConfigurationStore>();
        var actor = Guid.NewGuid();
        var recordedAt = DateTimeOffset.UtcNow;
        SharedDocument Catalog(string name, decimal price) => new(
            Guid.NewGuid(), "asset-catalog", Guid.NewGuid(), 1, 1, name, "",
            "Published", "Owner", actor, recordedAt, actor, recordedAt,
            JsonSerializer.SerializeToElement(new SharedCatalogData("Khác", "Cái", price, "Room")));
        var catalogs = new[]
        {
            Catalog("Bóng đèn", 110_000m),
            Catalog("Giường", 2_000_000m),
            Catalog("Tủ quần áo", 3_000_000m)
        };
        shared.ListAsync("asset-catalog", "", "Published", 1, 100,
                Arg.Any<CancellationToken>(), true)
            .Returns(new SharedPage(catalogs, catalogs.Length, 1, 100));
        var world = new World(shared);
        var bulbs = World.Item("Bóng đèn", 1) with { Category = "Khác", Unit = "Cái" };
        var bed = World.Item("Giường", 1) with { Category = "Khác", Unit = "Cái" };
        var wardrobe = World.Item("Tủ quần áo", 1) with { Category = "Khác", Unit = "Cái" };
        world.AddRoom(bulbs, bed, wardrobe);

        // These older room requirements have no referencePrice property. The
        // read-only inventory response still supplies the exact published
        // catalog suggestion; the frontend only lets Owner adjust it.
        var room = Assert.Single((await world.Read()).Rooms);
        Assert.Equal(110_000m, room.Items.Single(item => item.Name == "Bóng đèn").ReferenceUnitCost);
        Assert.Equal(2_000_000m, room.Items.Single(item => item.Name == "Giường").ReferenceUnitCost);
        Assert.Equal(3_000_000m, room.Items.Single(item => item.Name == "Tủ quần áo").ReferenceUnitCost);
        Assert.Empty(world.Assets);

        var input = new RoomInventoryReviewConfirm(Guid.NewGuid(),
        [
            World.Input(room, room.Items.Select(item => new RoomInventoryReviewInputItem(
                item.Id, true, [],
                item.Name == "Giường" ? 1_900_000m : item.ReferenceUnitCost)).ToArray())
        ], true);
        var confirmed = Assert.Single((await world.Confirm(input)).Rooms);
        Assert.Equal("Matched", confirmed.State);
        Assert.Equal(3, world.Assets.Count);
        Assert.Equal(110_000m, confirmed.Items.Single(item => item.Name == "Bóng đèn").AcquisitionUnitCost);
        Assert.Equal(1_900_000m, confirmed.Items.Single(item => item.Name == "Giường").AcquisitionUnitCost);
        Assert.Equal(3_000_000m, confirmed.Items.Single(item => item.Name == "Tủ quần áo").AcquisitionUnitCost);
        Assert.All(world.Metadata.Values, metadata => Assert.NotNull(metadata.PurchaseCost));
    }

    [Fact]
    public async Task PricedInventoryWritesDurableAcquisitionSnapshotAndRejectsRepricing()
    {
        var world = new World();
        var item = World.Item("Chair", 2) with { ReferencePrice = 1_500_000m };
        world.AddRoom(item);
        var initial = Assert.Single((await world.Read()).Rooms);
        Assert.Equal(1_500_000m, Assert.Single(initial.Items).ReferenceUnitCost);
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(initial, new RoomInventoryReviewInputItem(item.Id, true, [], 1_350_000m))], true);
        var confirmed = Assert.Single((await world.Confirm(command)).Rooms);
        var asset = Assert.Single(world.Assets);
        Assert.Equal(1_350_000m, world.Metadata[asset.Id].PurchaseCost);
        var snapshot = world.MetadataDocument(asset.Id);
        Assert.Equal("AssetMetadata", snapshot.Kind);
        Assert.Equal(1_350_000m, snapshot.Data.GetProperty("purchaseCost").GetDecimal());
        Assert.Equal(2, snapshot.Data.GetProperty("quantity").GetInt32());
        Assert.Equal(1_350_000m, Assert.Single(confirmed.Items).AcquisitionUnitCost);
        // The immutable metadata revision feeds pending capital even before
        // the daily financial journal job runs. Once posted it must not recur.
        var revision = new AssetCapitalRevision(snapshot.Version, 2,
            snapshot.Data.GetProperty("purchaseCost").GetDecimal(), null);
        var pending = Assert.Single(AssetCapitalMath.Pending(asset.Id, 2, 1_350_000m,
            null, snapshot.Version, [revision], [], false));
        Assert.Equal(2_700_000m, pending.Amount);
        Assert.Empty(AssetCapitalMath.Pending(asset.Id, 2, 1_350_000m,
            null, snapshot.Version, [revision],
            [new AssetCapitalPosted(pending.SourceKey, pending.Quantity, pending.UnitCost,
                pending.Amount, pending.MetadataVersion)], false));
        await world.Confirm(command);
        Assert.Single(world.Assets);
        Assert.Equal(snapshot.Version, world.MetadataDocument(asset.Id).Version);

        var replayRow = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("asset_acquisition_price_locked",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(new(Guid.NewGuid(),
                [World.Input(replayRow, new RoomInventoryReviewInputItem(item.Id, true, [], 2_000_000m))], true)))).Code);
        Assert.Equal(1_350_000m, world.Metadata[asset.Id].PurchaseCost);
    }

    [Fact]
    public async Task ExistingVerifiedUnpricedAssetAcceptsExplicitZeroWithoutRecreatingOrReinventory()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var asset = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, asset);
        var before = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("Matched", before.State);
        var confirmation = await world.Confirm(new(Guid.NewGuid(),
            [World.Input(before, new RoomInventoryReviewInputItem(item.Id, true, [], 0m))], true));
        var updated = Assert.Single(confirmation.Rooms);
        Assert.Equal("Matched", updated.State);
        Assert.Equal(0m, world.Metadata[asset.Id].PurchaseCost);
        Assert.Single(world.Assets);
        Assert.Equal(0m, world.MetadataDocument(asset.Id).Data.GetProperty("purchaseCost").GetDecimal());
    }

    [Fact]
    public async Task ConfirmationCreatesOneAssetPerGroupAndIsIdempotent()
    {
        var world = new World();
        world.AddRoom(World.Item("Chair"), World.Item("Desk", 1));
        var row = Assert.Single((await world.Read()).Rooms);
        var evidence = new[] { world.AddEvidence(), world.AddEvidence() };
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, World.CheckedItems(row, evidence).ToArray())], true);

        var confirmed = await world.Confirm(command);
        var result = Assert.Single(confirmed.Rooms);
        Assert.Equal("Matched", result.State);
        Assert.Equal(2, result.CheckedCount);
        Assert.All(result.Items, item => { Assert.True(item.Checked); Assert.Single(item.Evidence); });
        Assert.Equal(2, world.Assets.Count);
        Assert.All(world.Metadata.Values, metadata => Assert.Equal("BulkQuantity", metadata.TrackingMode));
        Assert.Equal(new[] { 2, 1 }, world.Metadata.Values.OrderBy(m => m.Quantity).Select(m => m.Quantity).OrderByDescending(x => x));

        var replay = await world.Confirm(command);
        Assert.Equal(result.Items.Select(i => i.Id), Assert.Single(replay.Rooms).Items.Select(i => i.Id));
        Assert.Equal(2, world.Assets.Count);

        var staffEvidence = world.AddEvidence();
        var firstAsset = world.Assets[0];
        var tokenBeforeStaffEvidence = result.StateToken;
        world.AppendStaffEvidence(firstAsset.Id, staffEvidence);
        var afterStaffEvidence = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("Matched", afterStaffEvidence.State);
        Assert.Equal(tokenBeforeStaffEvidence, afterStaffEvidence.StateToken);
        var firstGroup = afterStaffEvidence.Items.Single(i => i.Evidence.Any(e => e.Id == evidence[0]) ||
            i.Evidence.Any(e => e.Id == staffEvidence));
        Assert.True(firstGroup.Checked);
        Assert.Contains(firstGroup.Evidence, e => e.Id == staffEvidence);
    }

    [Fact]
    public async Task ExistingOwnerMappingWithoutPhotosIsAlreadyMatched()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var asset = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, asset);

        var previous = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("Matched", previous.State);
        Assert.Empty(Assert.Single(previous.Items).Evidence);
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(previous, new RoomInventoryReviewInputItem(item.Id, true, []))], true);
        var confirmed = Assert.Single((await world.Confirm(command)).Rooms);
        Assert.Equal(previous.StateToken, confirmed.StateToken);
        Assert.Same(asset, Assert.Single(world.Assets));
    }

    [Fact]
    public async Task ExistingAssetIdIsReusedAndUnlinkedAssetIsNeverDuplicated()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var originalEvidence = world.AddEvidence();
        var existing = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, existing, originalEvidence);
        var row = Assert.Single((await world.Read()).Rooms);
        Assert.Equal(new[] { existing.Id }, world.LastActiveAssetIds);
        var newEvidence = world.AddEvidence();
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, new RoomInventoryReviewInputItem(item.Id, true, [newEvidence]))], true);
        var result = Assert.Single((await world.Confirm(command)).Rooms);
        Assert.Equal("Matched", result.State);
        Assert.Same(existing, Assert.Single(world.Assets));
        Assert.Equal(item.Quantity, world.Metadata[existing.Id].Quantity);

        var secondWorld = new World();
        var secondItem = World.Item("Lamp");
        var secondRoom = secondWorld.AddRoom(secondItem);
        secondWorld.AddPhysical(secondRoom, secondItem, secondItem.Quantity, "UNLINKED");
        var unlinkedView = Assert.Single((await secondWorld.Read()).Rooms);
        Assert.Equal("NeedsReview", unlinkedView.State);
        var evidence = secondWorld.AddEvidence();
        var unlinkedCommand = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(unlinkedView, new RoomInventoryReviewInputItem(secondItem.Id, true, [evidence]))], true);
        var unlinkedResult = Assert.Single((await secondWorld.Confirm(unlinkedCommand)).Rooms);
        Assert.Equal("NeedsReview", unlinkedResult.State);
        Assert.Single(secondWorld.Assets);
        Assert.Equal("UNLINKED", secondWorld.Assets[0].Code);
    }

    [Fact]
    public async Task PurchaseMetadataChangesDoNotInvalidateInventoryAttestation()
    {
        var world = new World();
        var item = World.Item();
        var room = world.AddRoom(item);
        var originalEvidence = world.AddEvidence();
        var asset = world.AddPhysical(room, item, item.Quantity);
        world.AddOwnerMapping(room, item, asset, originalEvidence);
        var row = Assert.Single((await world.Read()).Rooms);
        var evidence = world.AddEvidence();
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, new RoomInventoryReviewInputItem(item.Id, true, [evidence]))], true);
        var matched = Assert.Single((await world.Confirm(command)).Rooms);
        Assert.Equal("Matched", matched.State);

        world.Metadata[asset.Id] = world.Metadata[asset.Id] with
        {
            PurchaseCost = 125000m,
            PurchaseDate = new DateOnly(2026, 1, 15),
            UsefulLifeMonths = 48
        };
        var after = Assert.Single((await world.Read()).Rooms);
        Assert.Equal("Matched", after.State);
        Assert.Equal(matched.StateToken, after.StateToken);
    }

    [Fact]
    public async Task InactiveLocationIsRejectedInsideConfirmationTransaction()
    {
        var world = new World();
        world.AddRoom(World.Item());
        var row = Assert.Single((await world.Read()).Rooms);
        var evidence = world.AddEvidence();
        world.Location.IsActive = false;
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, new RoomInventoryReviewInputItem(row.Items[0].Id, true, [evidence]))], true);
        Assert.Equal("location_inactive_or_missing",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(command))).Code);
        Assert.Empty(world.Assets);
    }

    [Fact]
    public async Task EvidenceMustBelongToTheSameLocation()
    {
        var world = new World();
        world.AddRoom(World.Item());
        var row = Assert.Single((await world.Read()).Rooms);
        var evidence = world.AddEvidence(Guid.NewGuid());
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [World.Input(row, new RoomInventoryReviewInputItem(row.Items[0].Id, true, [evidence]))], true);
        Assert.Equal("inventory_review_evidence_invalid",
            (await Assert.ThrowsAsync<PropertyException>(() => world.Confirm(command))).Code);
        Assert.Empty(world.Assets);
    }
}
