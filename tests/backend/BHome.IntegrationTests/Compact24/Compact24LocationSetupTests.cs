using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private const string SetupRoute = "/api/v1/location-setup";
    private static LocationSetupInput SetupDraft(bool active = true)
    {
        var id = Guid.NewGuid();
        var type = new SetupRoomDefaultsInput(Guid.NewGuid(), "Synthetic suite", "Test configuration", 3, 25m,
            2500000m, ["Window"], [new("Chair", "Furniture", "Serialized", 2)]);
        var empty = type with { Key = Guid.NewGuid(), Name = "Synthetic empty", Assets = [] };
        return new(new("Synthetic setup " + id, "Synthetic address", "TEST-" + id.ToString("N"), 2,
            "0900000000", "synthetic@example.invalid", "Synthetic metadata"), [type, empty],
            [new(Guid.NewGuid(), "101", "1", type.Key, 2700000m), new(Guid.NewGuid(), "201", "2", empty.Key, 2000000m)],
            [new(null, ChargeCategory.ServiceFee, "WIFI", "Internet", ChargingMethod.FixedPerRoomPerMonth, 50000m, Today, null)],
            new("Synthetic rules", "Owner reviewed rules", Today), active, Today.AddDays(2));
    }

    [CompactPostgresFact]
    public async Task LocationSetupPersistsNativeRecordsAndIndependentDesiredInventory()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var draft = SetupDraft(); var key = Guid.NewGuid();
        var result = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key));
        var location = result.Location.Id;
        Assert.True(result.Location.IsActive);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        Assert.Equal(draft.Location.Name, (await db.Locations.AsNoTracking().SingleAsync(l => l.Id == location)).Name);
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => r.LocationId == location).OrderBy(r => r.RoomNumber).ToArrayAsync();
        Assert.Equal(2, rooms.Length); Assert.All(rooms, r => { Assert.Equal(3, r.Capacity); Assert.Null(r.RoomTypeId); Assert.Equal(RoomStatus.Available, r.Status); });
        var fees = await db.Set<BillingPolicy>().AsNoTracking().Where(p => p.LocationId == location).ToArrayAsync();
        Assert.Equal(3, fees.Length); Assert.Equal(2700000m, fees.Single(p => p.RoomId == rooms[0].Id).Rate);
        Assert.All(fees.Where(p => p.RoomId != null), p => Assert.Equal(draft.RentEffectiveFrom, p.EffectiveFrom));
        Assert.Equal(50000m, fees.Single(p => p.RoomId == null).Rate);
        var beforeRent = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{rooms[0].Id}/prices?effectiveOn={Today:yyyy-MM-dd}"))!;
        Assert.DoesNotContain(beforeRent.Charges, p => p.Category == ChargeCategory.Rent);
        var onRent = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{rooms[0].Id}/prices?effectiveOn={draft.RentEffectiveFrom:yyyy-MM-dd}"))!;
        Assert.Equal(2700000m, Assert.Single(onRent.Charges, p => p.Category == ChargeCategory.Rent).Rate);
        Assert.Empty(await db.Set<Asset>().Where(a => a.LocationId == location).ToArrayAsync());
        Assert.Empty(await db.Set<Contract>().Where(c => c.Room.LocationId == location).ToArrayAsync());
        var defaults = await store.ListAsync(location, "RoomDefaults", default); Assert.Equal(2, defaults.Count);
        var metadata = Assert.Single(await store.ListAsync(location, "LocationMetadata", default));
        Assert.Equal(draft.Location.Code, metadata.Data.GetProperty("code").GetString());
        Assert.Equal(2, metadata.Data.GetProperty("floors").GetInt32());
        Assert.Equal("Completed", metadata.Data.GetProperty("setupStatus").GetString());
        var policy = Assert.Single(await store.ListAsync(location, "OperatingPolicy", default));
        Assert.Equal("Published", policy.Status); Assert.Equal(draft.Policy!.Content, policy.Data.GetProperty("content").GetString());
        var template = Assert.Single(await store.ListAsync(location, "AssetTemplate", default)); Assert.Equal("Published", template.Status);
        var provenance = await store.ListAsync(location, "RoomProvenance", default); Assert.Equal(2, provenance.Count);
        var first = (await owner.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{rooms[0].Id}/asset-inventory"))!;
        Assert.Equal(template.Id, first.AssignedTemplateId); Assert.NotNull(first.CurrentDesiredId);
        Assert.Single(first.Desired); Assert.Empty(first.Physical);
        var second = (await owner.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{rooms[1].Id}/asset-inventory"))!;
        Assert.Null(second.AssignedTemplateId); Assert.Empty(second.Desired); Assert.Empty(second.Physical);
        var replay = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key));
        Assert.Equal(location, replay.Location.Id); Assert.Equal(result.CreatedReferences, replay.CreatedReferences);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, draft with { Activate = false }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, draft, Guid.NewGuid())).StatusCode);
        Assert.Equal(1, await db.Locations.CountAsync(l => l.Name == draft.Location.Name));
    }

    [CompactPostgresFact]
    public async Task LocationSetupRollsBackAfterLateOperationInsertFailure()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var draft = SetupDraft(); var key = Guid.NewGuid();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var name = "test_setup_failure_" + Guid.NewGuid().ToString("N");
        var beforeLocations = await db.Locations.CountAsync();
        var beforeRooms = await db.Set<Room>().CountAsync();
        var beforeFees = await db.Set<BillingPolicy>().CountAsync();
        const string setupCountSql = "SELECT count(*)::integer AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType' LIKE 'Setup%' OR (task_data->>'recordType'='SharedConfigurationOperation' AND task_data->'operation'->>'kind'='LocationSetup')";
        var beforeDocuments = await db.Database.SqlQueryRaw<int>(setupCountSql).SingleAsync();
        // Identifiers are generated solely from a GUID, never request data.
        var create = $"CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.task_data->>''recordType''=''SharedConfigurationOperation'' AND NEW.task_data->''operation''->>''kind''=''LocationSetup'' THEN RAISE EXCEPTION ''Synthetic late setup failure''; END IF; RETURN NEW; END'; CREATE TRIGGER {name} BEFORE INSERT ON operational_tasks FOR EACH ROW EXECUTE FUNCTION {name}();";
        await db.Database.ExecuteSqlRawAsync(create);
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await Keyed(owner, SetupRoute, draft, key)).StatusCode);
            Assert.Equal(beforeLocations, await db.Locations.CountAsync());
            Assert.Equal(beforeRooms, await db.Set<Room>().CountAsync());
            Assert.Equal(beforeFees, await db.Set<BillingPolicy>().CountAsync());
            Assert.Equal(beforeDocuments, await db.Database.SqlQueryRaw<int>(setupCountSql).SingleAsync());
            Assert.False(await db.Locations.AnyAsync(l => l.Name == draft.Location.Name));
        }
        finally { var drop = $"DROP TRIGGER {name} ON operational_tasks; DROP FUNCTION {name}();"; await db.Database.ExecuteSqlRawAsync(drop); }
        // The exact same key may retry after rollback; no partial idempotency record survives.
        var saved = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key));
        Assert.Equal(draft.Location.Name, saved.Location.Name);
    }

    [CompactPostgresFact]
    public async Task LocationSetupSourceSnapshotIsStableAndCopyRemainsIndependent()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var original = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft(), Guid.NewGuid()));
        var location = original.Location.Id;
        var route = $"{SetupRoute}/source/{location}";
        var beforePhysical = (await owner.GetFromJsonAsync<LocationSetupSource>(route))!;
        Guid sourceRoom;
        await using (var sourceScope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var sourceDb = sourceScope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            sourceRoom = await sourceDb.Set<Room>().Where(r => r.LocationId == location && r.RoomNumber == "101").Select(r => r.Id).SingleAsync();
            sourceDb.Add(new Asset { LocationId = location, RoomId = sourceRoom, Name = "Source physical chair", Category = "Furniture", Code = "SRC-CHAIR", Condition = "Good" });
            await sourceDb.SaveChangesAsync();
        }
        Assert.Equal(beforePhysical.SourceState, (await owner.GetFromJsonAsync<LocationSetupSource>(route))!.SourceState);
        var sourceFee = await Read<PolicyDto>(await owner.PostAsJsonAsync("/api/v1/billing-policies", new PolicyWrite(location, sourceRoom, ChargeCategory.ServiceFee, "CLEANING", "Room cleaning", ChargingMethod.FixedPerRoomPerMonth, 120000m, Today, null)));
        var source = (await owner.GetFromJsonAsync<LocationSetupSource>(route))!;
        Assert.NotEqual(beforePhysical.SourceState, source.SourceState);
        Assert.Equal(source.SourceState, (await owner.GetFromJsonAsync<LocationSetupSource>(route))!.SourceState);
        Assert.Contains(source.Fees, p => p.Id == sourceFee.Id && p.RoomId == sourceRoom);
        Assert.DoesNotContain(source.Fees, p => p.Category == ChargeCategory.Rent && p.RoomId.HasValue);
        var type = source.RoomTypes.Single(d => d.Data.GetProperty("name").GetString() == "Synthetic suite");
        var draft = SetupDraft();
        draft = draft with
        {
            SourceLocationId = location,
            SourceState = source.SourceState,
            RoomTypes = [draft.RoomTypes[0] with { SourceId = type.Id, SourceVersion = type.Version, SourceKind = "RoomDefaults" }, draft.RoomTypes[1]],
            SourceReferences = [new(type.Id, type.Version, "RoomDefaults"), new(sourceFee.Id, sourceFee.Version, "BillingPolicy")],
            Fees = [.. draft.Fees, new(draft.Rooms[1].Key, sourceFee.Category, sourceFee.ChargeCode, sourceFee.Name, sourceFee.Method, sourceFee.Rate, Today, null)]
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await Keyed(owner, SetupRoute, draft with { Fees = [.. draft.Fees.Select(fee => fee with { RoomKey = null })] }, Guid.NewGuid())).StatusCode);
        var copyKey = Guid.NewGuid();
        var copy = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, copyKey));
        var edit = new LocalRoomDefaultsWrite("Changed source", "Independent source edit", new(4, 30m, ["Changed"], 3000000m), null, type.Version, "Source update");
        var update = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/locations/{location}/room-defaults/{type.Id}", edit));
        Assert.Equal(type.Version + 1, update.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, draft with { Location = SetupDraft().Location }, Guid.NewGuid())).StatusCode);
        var current = (await owner.GetFromJsonAsync<LocationSetupSource>(route))!; Assert.NotEqual(source.SourceState, current.SourceState);
        var staleVersion = draft with { Location = SetupDraft().Location, SourceState = current.SourceState };
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, staleVersion, Guid.NewGuid())).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var targetRoom = await db.Set<Room>().Where(r => r.LocationId == copy.Location.Id && r.RoomNumber == "201").Select(r => r.Id).SingleAsync();
        var targetFee = await db.Set<BillingPolicy>().SingleAsync(p => p.LocationId == copy.Location.Id && p.ChargeCode == "CLEANING");
        Assert.Equal(targetRoom, targetFee.RoomId); Assert.NotEqual(sourceRoom, targetFee.RoomId); Assert.NotEqual(sourceFee.Id, targetFee.Id);
        Assert.Empty(await db.Set<Asset>().Where(a => a.LocationId == copy.Location.Id).ToArrayAsync());
        Assert.Equal(1, await db.Set<Asset>().CountAsync(a => a.LocationId == location));
        var operation = await scope.ServiceProvider.GetRequiredService<ISharedConfigurationStore>().OperationAsync(w.Owner.Id, "LocationSetup", copyKey, default);
        Assert.NotNull(operation); Assert.Contains(operation.SourceReferences!, r => r.Id == sourceFee.Id && r.Version == sourceFee.Version && r.Kind == "BillingPolicy");
        var copied = (await store.ListAsync(copy.Location.Id, "RoomDefaults", default)).Single(d => d.Data.TryGetProperty("copiedFromId", out var id) && id.GetGuid() == type.Id);
        Assert.Equal("Synthetic suite", copied.Data.GetProperty("name").GetString());
        Assert.Equal(3, copied.Data.GetProperty("defaults").GetProperty("capacity").GetInt32());
        Assert.NotEqual(type.Id, copied.Id);
        Assert.Equal(type.Version, copied.Data.GetProperty("copiedFromVersion").GetInt32());
    }

    [CompactPostgresFact]
    public async Task LocationSetupRejectsNonOwnerStaleAndArchivedDefaults()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); using var tenant = await Client(w.Tenant);
        var draft = SetupDraft(); var key = Guid.NewGuid();
        foreach (var client in new[] { staff, tenant })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await Keyed(client, SetupRoute, draft, key)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"{SetupRoute}/source/{w.Location}")).StatusCode);
        }
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key))).Location.Id;
        var route = $"/api/v1/locations/{location}/room-defaults";
        var write = new LocalRoomDefaultsWrite("Additional room", "", new(2, 18m, [], 1000000m), null);
        var type = await Read<SetupDocument>(await owner.PostAsJsonAsync(route, write));
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(route, write)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, write)).StatusCode);
        var update = write with { ExpectedVersion = type.Version, Reason = "Changed capacity", Defaults = new(3, 18m, [], 1000000m) };
        var updated = await Read<SetupDocument>(await owner.PutAsJsonAsync($"{route}/{type.Id}", update));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"{route}/{type.Id}", update)).StatusCode);
        var rooms = new ConfiguredRoomsInput([new("301", "2", type.Id, type.Version, 1000000m)], Today);
        var bulk = $"/api/v1/locations/{location}/configured-rooms";
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, bulk, rooms, Guid.NewGuid())).StatusCode);
        var currentRooms = rooms with { Rooms = [rooms.Rooms[0] with { ExpectedVersion = updated.Version }] };
        var roomKey = Guid.NewGuid(); var created = await Read<BulkRoomResult>(await Keyed(owner, bulk, currentRooms, roomKey));
        Assert.Equal(3, Assert.Single(created.Rooms).Capacity);
        Assert.Equal(created.Rooms[0].Id, Assert.Single((await Read<BulkRoomResult>(await Keyed(owner, bulk, currentRooms, roomKey))).Rooms).Id);
        var archived = await Read<SetupDocument>(await owner.PutAsJsonAsync($"{route}/{type.Id}", update with { Name = "Should not rewrite archive", AssetTemplateId = Guid.NewGuid(), ExpectedVersion = updated.Version, Status = "Archived", Reason = "Retired" }));
        Assert.Equal("Additional room", archived.Data.GetProperty("name").GetString());
        Assert.Equal(updated.Data.GetProperty("defaults").GetProperty("capacity").GetInt32(), archived.Data.GetProperty("defaults").GetProperty("capacity").GetInt32());
        Assert.Equal(updated.Data.GetProperty("defaults").GetProperty("area").ToString(), archived.Data.GetProperty("defaults").GetProperty("area").ToString());
        var history = (await owner.GetFromJsonAsync<SetupDocument[]>($"{route}/{type.Id}/history"))!;
        Assert.Equal(new[] { 1, 2, 3 }, history.Select(d => d.Version));
        var archivedRooms = currentRooms with { Rooms = [currentRooms.Rooms[0] with { RoomNumber = "302", ExpectedVersion = archived.Version }] };
        Assert.Equal(HttpStatusCode.BadRequest, (await Keyed(owner, bulk, archivedRooms, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/locations/{w.Location}/room-defaults/{type.Id}/history")).StatusCode);
        Assert.DoesNotContain((await owner.GetFromJsonAsync<LocationSetupSource>($"{SetupRoute}/source/{location}"))!.RoomTypes, d => d.Id == archived.Id);
        var archivedCopy = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", new ConfigurationCopy(location, w.Location, ["RoomDefaults"])));
        Assert.DoesNotContain(archivedCopy.Changes, change => change.Contains("Additional room"));
    }

    [CompactPostgresFact]
    public async Task LocationSetupInactiveRoomsRemainUnavailableAndCanBeReactivatedExplicitly()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var result = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft(false), Guid.NewGuid()));
        Assert.False(result.Location.IsActive);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => r.LocationId == result.Location.Id).ToArrayAsync();
        Assert.Equal(2, rooms.Length); Assert.All(rooms, r => Assert.Equal(RoomStatus.Unavailable, r.Status));
        var source = (await owner.GetFromJsonAsync<LocationSetupSource>($"{SetupRoute}/source/{result.Location.Id}"))!;
        var bulk = new ConfiguredRoomsInput([new("303", "2", source.RoomTypes[0].Id, source.RoomTypes[0].Version, 1000000m)], Today);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, $"/api/v1/locations/{result.Location.Id}/configured-rooms", bulk, Guid.NewGuid())).StatusCode);
        var location = result.Location;
        await Read<LocationDto>(await owner.PutAsJsonAsync($"/api/v1/locations/{location.Id}", new LocationWrite(location.Name, location.Address, true, location.Version, "Owner opens location")));
        var room = rooms[0]; var updated = await Read<RoomDto>(await owner.PutAsJsonAsync($"/api/v1/rooms/{room.Id}", new RoomWrite(location.Id, room.RoomNumber, room.Floor, room.Capacity, RoomStatus.Available, room.Version, "Owner opens room")));
        Assert.Equal(RoomStatus.Available, updated.Status);
    }

    [CompactPostgresFact]
    public async Task LocationSetupConcurrentReplayCreatesOneLocationAndRejectsDifferentPayload()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var draft = SetupDraft(); var key = Guid.NewGuid();
        var requests = await Task.WhenAll(Keyed(owner, SetupRoute, draft, key), Keyed(owner, SetupRoute, draft, key));
        var first = await Read<LocationSetupResult>(requests[0]); var second = await Read<LocationSetupResult>(requests[1]);
        Assert.Equal(first.Location, second.Location); Assert.Equal(first.CreatedReferences, second.CreatedReferences);
        var different = draft with { Location = draft.Location with { Name = "Changed " + draft.Location.Name } };
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, different, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, different with { Location = different.Location with { Code = draft.Location.Code.ToLowerInvariant() } }, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Keyed(owner, SetupRoute, SetupDraft() with { RentEffectiveFrom = Today.AddDays(-1) }, Guid.NewGuid())).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(1, await db.Locations.CountAsync(l => l.Name == draft.Location.Name));
        Assert.Equal(2, await db.Set<Room>().CountAsync(r => r.LocationId == first.Location.Id));
        Assert.Equal(3, await db.Set<BillingPolicy>().CountAsync(p => p.LocationId == first.Location.Id));
        var operation = await scope.ServiceProvider.GetRequiredService<ISharedConfigurationStore>().OperationAsync(w.Owner.Id, "LocationSetup", key, default);
        Assert.NotNull(operation); Assert.Equal(first.Location.Id, operation.TargetLocationId);
    }

    [CompactPostgresFact]
    public async Task LocationSetupValidatesEverySelectedSharedReferenceAndPreservesPublishedSource()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var room = await Published(owner, "room-type-templates"); var asset = await Published(owner, "asset-templates");
        var catalog = await Published(owner, "asset-catalog"); var fee = await Published(owner, "fee-templates"); var policy = await Published(owner, "policy-templates");
        var docs = new[] { room, asset, catalog, fee, policy };
        var draft = SetupDraft();
        draft = draft with
        {
            RoomTypes = [draft.RoomTypes[0] with { SourceId = room.Id, SourceVersion = room.Version, SourceKind = "SharedTemplate" }, draft.RoomTypes[1]],
            SourceReferences = docs.Select(doc => new ConfigurationSourceReference(doc.Id, doc.Version, doc.Resource)).ToArray()
        };
        foreach (var doc in docs)
        {
            var stale = draft with { SourceReferences = draft.SourceReferences.Select(reference => reference.Id == doc.Id ? reference with { Version = reference.Version + 1 } : reference).ToArray() };
            Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, stale, Guid.NewGuid())).StatusCode);
        }
        var notPublished = await Read<SharedDocument>(await owner.PostAsJsonAsync("/api/v1/shared-configuration/asset-catalog", SharedInput("asset-catalog")));
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, draft with { SourceReferences = [new(notPublished.Id, notPublished.Version, notPublished.Resource)] }, Guid.NewGuid())).StatusCode);
        var key = Guid.NewGuid(); var result = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key));
        var roomRoute = $"/api/v1/shared-configuration/{room.Resource}/{room.Id}";
        var unchanged = (await owner.GetFromJsonAsync<SharedDocument>(roomRoute))!;
        Assert.Equal(room.Version, unchanged.Version); Assert.Equal(room.Status, unchanged.Status);
        Assert.Equal(room.Data.GetProperty("capacity").GetInt32(), unchanged.Data.GetProperty("capacity").GetInt32());
        var policyRoute = $"/api/v1/shared-configuration/{policy.Resource}/{policy.Id}";
        var archived = await Read<SharedDocument>(await owner.PostAsJsonAsync(policyRoute + "/archive", new SharedVersion(policy.Version)));
        Assert.Equal("Archived", archived.Status);
        var next = draft with { Location = SetupDraft().Location };
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, SetupRoute, next, Guid.NewGuid())).StatusCode);
        // A committed operation can replay even if its former source is no longer selectable.
        Assert.Equal(result.Location.Id, (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, key))).Location.Id);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var local = (await store.ListAsync(result.Location.Id, "RoomDefaults", default)).Single(d => d.Data.TryGetProperty("sourceId", out var id) && id.GetGuid() == room.Id);
        Assert.Equal(room.Version, local.Data.GetProperty("sourceVersion").GetInt32());
        Assert.Equal("Synthetic suite", local.Data.GetProperty("name").GetString());
        Assert.Equal("Owner reviewed rules", Assert.Single(await store.ListAsync(result.Location.Id, "OperatingPolicy", default)).Data.GetProperty("content").GetString());
        var operation = await scope.ServiceProvider.GetRequiredService<ISharedConfigurationStore>().OperationAsync(w.Owner.Id, "LocationSetup", key, default);
        Assert.NotNull(operation); Assert.Equal(docs.Length, operation.SourceReferences!.Length);
        Assert.All(docs, doc => Assert.Contains(operation.SourceReferences, reference => reference.Id == doc.Id && reference.Version == doc.Version && reference.Kind == doc.Resource));
    }

    [CompactPostgresFact]
    public async Task LocationSetupConfiguredRoomCannotVerifySupersededDesiredAssets()
    {
        var w = await Seed(); using var host = Host(); using var owner = await Client(w.Owner, host);
        var result = await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, SetupDraft(), Guid.NewGuid()));
        var location = result.Location.Id; var source = (await owner.GetFromJsonAsync<LocationSetupSource>($"{SetupRoute}/source/{location}"))!;
        var initialTemplate = Assert.Single(source.AssetTemplates);
        var draftTemplate = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates", new AssetTemplateWrite(location, "Later package", [new(Guid.NewGuid(), "Desk", "Furniture", "Serialized", 1)])));
        var localRoute = $"/api/v1/locations/{location}/room-defaults";
        var defaults = new LocalRoomDefaultsWrite("Later defaults", "", new(2, 20m, [], 1000000m), draftTemplate.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(localRoute, defaults)).StatusCode);
        await Read<AssetSyncRun>(await owner.PostAsJsonAsync($"/api/v1/asset-templates/{draftTemplate.Id}/publish", new TemplatePublish(draftTemplate.Version)));
        await Read<SetupDocument>(await owner.PostAsJsonAsync(localRoute, defaults));
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var room = await db.Set<Room>().Where(r => r.LocationId == location && r.RoomNumber == "101").Select(r => r.Id).SingleAsync();
        var unassignedRoom = await db.Set<Room>().Where(r => r.LocationId == location && r.RoomNumber == "201").Select(r => r.Id).SingleAsync();
        var inventoryRoute = $"/api/v1/rooms/{room}/asset-inventory";
        var pinned = (await owner.GetFromJsonAsync<AssetInventory>(inventoryRoute))!;
        Assert.Equal(initialTemplate.Id, pinned.AssignedTemplateId);
        var desired = Assert.Single(pinned.Desired);
        Assert.Equal(desired.Id, pinned.CurrentDesiredId);
        Assert.Empty((await owner.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{unassignedRoom}/asset-inventory"))!.Desired);
        var item = desired.Data.GetProperty("items")[0].GetProperty("id").GetGuid();
        var evidence = await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().UploadEvidenceAsync(location, [1, 2, 3], "image/png", w.Owner.Id, default);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/rooms/{room}/asset-template", new AssetTemplateAssignment(null, pinned.AssignmentVersion)));
        var cleared = (await owner.GetFromJsonAsync<AssetInventory>(inventoryRoute))!;
        Assert.Null(cleared.AssignedTemplateId); Assert.Null(cleared.CurrentDesiredId); Assert.Single(cleared.Desired);
        var verification = new AssetVerification(initialTemplate.Id, item, "STALE-CHAIR", 1, "Good", evidence, desired.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/v1/rooms/{room}/assets/verify", verification)).StatusCode);
        Assert.Empty(await db.Set<Asset>().Where(a => a.LocationId == location).ToArrayAsync());
    }
}

