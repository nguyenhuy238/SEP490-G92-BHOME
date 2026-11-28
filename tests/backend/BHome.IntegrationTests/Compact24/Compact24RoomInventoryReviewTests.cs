using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    // Read the wire representation, not the domain entity: AuditableEntity.Id has a
    // protected setter and deserializing Asset generates a new ID instead of reading it.
    private sealed record InventoryAssetResponse(Guid Id, string? Code, string Condition);
    private sealed record InventoryResponse(IReadOnlyList<InventoryAssetResponse> Physical,
        IReadOnlyList<SetupDocument> Desired, IReadOnlyDictionary<Guid, AssetMetadata>? Metadata, Guid? CurrentDesiredId);

    private static string ReviewRoute(Guid location) => $"/api/v1/locations/{location}/room-inventory-review";
    private static RoomInventoryReviewInputRoom ReviewRoom(RoomInventoryReviewRoom room, params RoomInventoryReviewInputItem[] items) =>
        new(room.RoomId, room.DesiredId, room.DesiredVersion, room.StateToken, items);
    private static byte[] ReviewEvidenceImage()
    {
        using var image = new Mat(16, 16, MatType.CV_8UC3, Scalar.White);
        return image.ImEncode(".png");
    }
    private async Task<SetupEvidenceUpload> UploadReviewEvidence(HttpClient client, Guid location)
    {
        using var content = new ByteArrayContent(ReviewEvidenceImage());
        content.Headers.ContentType = new("image/png");
        return await Read<SetupEvidenceUpload>(await client.PostAsync($"/api/v1/locations/{location}/setup-evidence", content));
    }

    [CompactPostgresFact]
    public async Task OwnerChecklistWithEvidenceIsAtomicAndIdempotentAndLeavesNoConfigRoomUnconfirmed()
    {
        var w = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host);
        using var staff = await Client(w.Staff, host);
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft(), Guid.NewGuid()))).Location.Id;
        var route = ReviewRoute(location);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);

        var view = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(route))!;
        Assert.Equal(2, view.Rooms.Count);
        var configured = view.Rooms.Single(r => r.Items.Count > 0);
        var noConfiguration = view.Rooms.Single(r => r.Items.Count == 0);
        Assert.Equal("NotChecked", configured.State);
        Assert.Equal("NotChecked", noConfiguration.State);
        Assert.Equal("no_asset_requirements", noConfiguration.BlockedReason);
        var evidence = await UploadReviewEvidence(owner, location);
        Assert.NotEqual(Guid.Empty, evidence.EvidenceId);
        Assert.StartsWith($"images/locations/{location:N}/setup/", evidence.ObjectKey);

        var inputRoom = ReviewRoom(configured, new RoomInventoryReviewInputItem(
            configured.Items[0].Id, true, [evidence.EvidenceId]));
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(), [inputRoom], true);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(route + "/confirm", command)).StatusCode);

        var stale = command with { Rooms = [inputRoom with { StateToken = "stale" }] };
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/confirm", stale)).StatusCode);
        var outside = command with { Rooms = [inputRoom with { RoomId = w.Room }] };
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsJsonAsync(route + "/confirm", outside)).StatusCode);
        var nullItem = command with { Rooms = [inputRoom with { Items = [null!] }] };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(route + "/confirm", nullItem)).StatusCode);
        await using (var check = fixture.Factory!.Services.CreateAsyncScope())
            Assert.False(await check.ServiceProvider.GetRequiredService<Compact24ArchiveContext>().Set<Asset>().AnyAsync(a => a.LocationId == location));

        var confirmed = await Read<RoomInventoryReviewView>(await owner.PostAsJsonAsync(route + "/confirm", command));
        var confirmedRoom = confirmed.Rooms.Single(r => r.RoomId == configured.RoomId);
        Assert.Equal("Matched", confirmedRoom.State);
        Assert.Equal(1, confirmedRoom.CheckedCount);
        var checkedItem = Assert.Single(confirmedRoom.Items);
        Assert.True(checkedItem.Checked);
        Assert.Equal(evidence.EvidenceId, Assert.Single(checkedItem.Evidence).Id);
        Assert.Equal("NotChecked", confirmed.Rooms.Single(r => r.RoomId == noConfiguration.RoomId).State);

        var replay = await Read<RoomInventoryReviewView>(await owner.PostAsJsonAsync(route + "/confirm", command));
        Assert.Equal(confirmedRoom.StateToken, replay.Rooms.Single(r => r.RoomId == configured.RoomId).StateToken);
        var otherEvidence = await UploadReviewEvidence(owner, location);
        var mismatch = command with
        {
            Rooms = [inputRoom with { Items = [new(configured.Items[0].Id, true, [otherEvidence.EvidenceId])] }]
        };
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/confirm", mismatch)).StatusCode);

        var repeat = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [ReviewRoom(confirmedRoom, new RoomInventoryReviewInputItem(checkedItem.Id, true, [evidence.EvidenceId]))], true);
        var repeated = await Read<RoomInventoryReviewView>(await owner.PostAsJsonAsync(route + "/confirm", repeat));
        Assert.Equal("Matched", repeated.Rooms.Single(r => r.RoomId == configured.RoomId).State);

        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var assets = await db.Set<Asset>().Where(a => a.LocationId == location).ToArrayAsync();
        var asset = Assert.Single(assets);
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var metadata = (await store.AssetMetadataAsync([asset.Id], default))[asset.Id];
        Assert.Equal("BulkQuantity", metadata.TrackingMode);
        Assert.Equal(2, metadata.Quantity);
        Assert.Equal(configured.Items[0].Unit, metadata.Unit);
        var mappings = await store.ListAsync(location, "AssetVerification", default);
        var mapping = Assert.Single(mappings);
        Assert.Equal("OwnerAttestation", mapping.Data.GetProperty("source").GetString());
        Assert.Equal(evidence.EvidenceId, mapping.Data.GetProperty("evidenceIds")[0].GetGuid());
    }

    [CompactPostgresFact]
    public async Task StaffCanAppendEvidenceToOwnerAttestedAssetWithoutChangingItsIdentityOrOwnerState()
    {
        var w = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host);
        using var staff = await Client(w.Staff, host);
        var draft = SetupDraft();
        draft = draft with
        {
            RoomTypes =
            [
                draft.RoomTypes[0] with { Assets = [new("Chair", "Furniture", "Serialized", 1)] },
                draft.RoomTypes[1]
            ]
        };
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, Guid.NewGuid()))).Location.Id;
        var route = ReviewRoute(location);
        await using (var assignmentScope = host.Services.CreateAsyncScope())
        {
            var assignmentDb = assignmentScope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            assignmentDb.Add(new StaffLocationAssignment(location, w.Staff.Id, w.Owner.Id, Today.AddYears(-1), Today.AddYears(1)));
            await assignmentDb.SaveChangesAsync();
        }
        var initialReview = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(route))!;
        var initialRoom = initialReview.Rooms.Single(r => r.Items.Count > 0);
        var staffInventoryBefore = (await staff.GetFromJsonAsync<InventoryResponse>($"/api/v1/rooms/{initialRoom.RoomId}/asset-inventory"))!;
        var desiredBefore = staffInventoryBefore.Desired.Single(d => d.Id == staffInventoryBefore.CurrentDesiredId);
        var requirement = desiredBefore.Data.GetProperty("items")[0];
        var initialStaffEvidence = await UploadReviewEvidence(staff, location);
        var initialStaffVerification = new AssetVerification(
            desiredBefore.Data.GetProperty("templateId").GetGuid(),
            requirement.GetProperty("id").GetGuid(),
            "STAFF-CHAIR-1",
            1,
            "Hoạt động tốt",
            initialStaffEvidence.ObjectKey,
            desiredBefore.Version);
        var initialStaffResult = await Read<JsonElement>(await staff.PostAsJsonAsync(
            $"/api/v1/rooms/{initialRoom.RoomId}/assets/verify", initialStaffVerification));
        var assetId = initialStaffResult.GetProperty("assetId").GetGuid();

        var ownerEvidence = await UploadReviewEvidence(owner, location);
        var before = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(route))!;
        var room = before.Rooms.Single(r => r.Items.Count > 0);
        var item = Assert.Single(room.Items);
        Assert.Equal("Matched", room.State);
        Assert.True(item.Checked);
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [ReviewRoom(room, new RoomInventoryReviewInputItem(item.Id, true, [ownerEvidence.EvidenceId]))], true);
        var confirmed = await Read<RoomInventoryReviewView>(await owner.PostAsJsonAsync(route + "/confirm", command));
        var confirmedRoom = confirmed.Rooms.Single(r => r.RoomId == room.RoomId);
        var originalToken = confirmedRoom.StateToken;

        var inventory = (await staff.GetFromJsonAsync<InventoryResponse>($"/api/v1/rooms/{room.RoomId}/asset-inventory"))!;
        var desired = inventory.Desired.Single(d => d.Id == inventory.CurrentDesiredId);
        var asset = Assert.Single(inventory.Physical);
        Assert.Equal(assetId, asset.Id);
        var metadata = inventory.Metadata![asset.Id];
        var staffEvidence = await UploadReviewEvidence(staff, location);
        var verify = new AssetVerification(
            desired.Data.GetProperty("templateId").GetGuid(),
            item.Id,
            asset.Code!,
            metadata.Quantity,
            asset.Condition,
            staffEvidence.ObjectKey,
            desired.Version,
            asset.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.PostAsJsonAsync(
            $"/api/v1/rooms/{room.RoomId}/assets/verify", verify with { ExpectedVersion = desired.Version - 1 })).StatusCode);
        var appended = await Read<JsonElement>(await staff.PostAsJsonAsync($"/api/v1/rooms/{room.RoomId}/assets/verify", verify));
        Assert.Equal(asset.Id, appended.GetProperty("assetId").GetGuid());
        var replay = await Read<JsonElement>(await staff.PostAsJsonAsync($"/api/v1/rooms/{room.RoomId}/assets/verify", verify));
        Assert.Equal(asset.Id, replay.GetProperty("assetId").GetGuid());

        var afterInventory = (await staff.GetFromJsonAsync<InventoryResponse>($"/api/v1/rooms/{room.RoomId}/asset-inventory"))!;
        Assert.Equal(asset.Id, Assert.Single(afterInventory.Physical).Id);
        Assert.Equal(metadata.Quantity, afterInventory.Metadata![asset.Id].Quantity);
        Assert.Equal(asset.Condition, afterInventory.Physical.Single().Condition);

        var after = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(route))!;
        var afterRoom = after.Rooms.Single(r => r.RoomId == room.RoomId);
        Assert.Equal("Matched", afterRoom.State);
        Assert.Equal(originalToken, afterRoom.StateToken);
        var afterItem = Assert.Single(afterRoom.Items);
        Assert.True(afterItem.Checked);
        Assert.Contains(afterItem.Evidence, e => e.Id == ownerEvidence.EvidenceId);
        Assert.Contains(afterItem.Evidence, e => e.Id == staffEvidence.EvidenceId);

        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var mapping = Assert.Single(await store.ListAsync(location, "AssetVerification", default),
            d => d.Data.TryGetProperty("source", out var source) && source.GetString() == "OwnerAttestation");
        Assert.Equal(ownerEvidence.EvidenceId, mapping.Data.GetProperty("evidenceIds")[0].GetGuid());
        Assert.Equal(staffEvidence.EvidenceId, mapping.Data.GetProperty("staffEvidenceIds")[0].GetGuid());
        Assert.Equal(2, (await store.HistoryAsync(mapping.Id, "AssetVerification", default)).Count);
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Single(await db.Set<Asset>().Where(a => a.LocationId == location).ToArrayAsync());
    }

    [CompactPostgresFact]
    public async Task SaveBatchCanInsertAndUpdateTogetherAndStaleBatchRollsBackItsInsert()
    {
        var w = await Seed();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var existingId = Guid.NewGuid();
        var actor = w.Owner.Id;
        var existing = await store.SaveAsync(existingId, w.Location, "InventoryBatchTest", "Created",
            new { value = 1 }, 0, actor, default);
        var insertedId = Guid.NewGuid();
        var saved = await store.TransactionAsync(w.Location, () => store.SaveBatchAsync(w.Location,
        [
            new(existingId, "InventoryBatchTest", "Updated", new { value = 2 }, existing.Version),
            new(insertedId, "InventoryBatchTest", "Created", new { value = 10 }, 0)
        ], actor, default), default);
        Assert.Equal(2, saved.Count);
        Assert.Equal(2, saved.Single(d => d.Id == existingId).Version);
        Assert.Equal(1, saved.Single(d => d.Id == insertedId).Version);
        Assert.Equal(new[] { 1, 2 }, (await store.HistoryAsync(existingId, "InventoryBatchTest", default)).Select(d => d.Version));

        var rolledBackId = Guid.NewGuid();
        await Assert.ThrowsAsync<PropertyException>(() => store.TransactionAsync(w.Location, () =>
            store.SaveBatchAsync(w.Location,
            [
                new(existingId, "InventoryBatchTest", "Stale", new { value = 3 }, existing.Version),
                new(rolledBackId, "InventoryBatchTest", "MustRollback", new { value = 99 }, 0)
            ], actor, default), default));
        Assert.Null(await store.GetAsync(rolledBackId, "InventoryBatchTest", default));
        Assert.Equal(2, (await store.GetAsync(existingId, "InventoryBatchTest", default))!.Version);
    }

    [CompactPostgresFact]
    public async Task InactiveLocationCannotConfirmRoomInventory()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft(false), Guid.NewGuid()))).Location.Id;
        var route = ReviewRoute(location);
        var view = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(route))!;
        var room = view.Rooms.Single(r => r.Items.Count > 0);
        var command = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [ReviewRoom(room, new RoomInventoryReviewInputItem(room.Items[0].Id, true, [Guid.NewGuid()]))], true);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/confirm", command)).StatusCode);
    }
}
