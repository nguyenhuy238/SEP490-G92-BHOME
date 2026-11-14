using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private static RoomConfigurationEdit ConfigurationEdit(RoomConfigurationView view, string reason = "Synthetic configuration edit") =>
        new(view.Room.RoomNumber, view.Room.Floor, view.Room.Capacity, view.Room.Status, view.Room.Version,
            view.Provenance?.Version ?? 0, reason);

    [CompactPostgresFact]
    public async Task RoomConfigurationEditsAtomicallyAndPreservesPhysicalAssetsAndEffectiveRentHistory()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var draft = SetupDraft() with { RentEffectiveFrom = Today };
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, Guid.NewGuid()))).Location.Id;
        Guid roomId, otherId, physicalId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var rooms = await db.Set<Room>().Where(r => r.LocationId == location).OrderBy(r => r.RoomNumber).ToArrayAsync();
            roomId = rooms[0].Id; otherId = rooms[1].Id;
            var physical = new Asset { LocationId = location, RoomId = roomId, Code = "SYN-CHAIR", Name = "Chair", Category = "Furniture", Condition = "Good" };
            db.Add(physical); await db.SaveChangesAsync(); physicalId = physical.Id;
        }
        var route = $"/api/v1/locations/{location}/rooms/{roomId}/configuration";
        var view = await Read<RoomConfigurationView>(await owner.GetAsync(route));
        Assert.True(view.CanEdit); Assert.NotNull(view.Rent); Assert.NotNull(view.Provenance);
        Assert.Equal(2700000m, view.Rent.Rate);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/locations/{w.Location}/rooms/{roomId}/configuration")).StatusCode);
        var item = new AssetTemplateItem(Guid.NewGuid(), "Desk", "Furniture", "Serialized", 2);
        var edit = ConfigurationEdit(view) with
        {
            RoomNumber = "101A",
            Floor = "2",
            Capacity = 4,
            Area = 30m,
            Amenities = ["Window", "Balcony"],
            Rent = new(3100000m, Today.AddDays(1), view.Rent.Id, view.Rent.Version),
            Assets = new([item], view.Inventory.AssignmentVersion)
        };
        var updated = await Read<RoomConfigurationView>(await owner.PutAsJsonAsync(route, edit));
        Assert.Equal("101A", updated.Room.RoomNumber); Assert.Equal("2", updated.Room.Floor); Assert.Equal(4, updated.Room.Capacity);
        Assert.Equal(30m, updated.Provenance!.Data.GetProperty("area").GetDecimal());
        Assert.Equal(2, updated.Provenance.Version); Assert.Equal(2700000m, updated.Rent!.Rate);
        Assert.Equal(3100000m, updated.ScheduledRent!.Rate);
        Assert.Single(updated.Inventory.Physical);
        // Domain entities have protected Id setters; inspect the wire ID rather than a deserialized entity's generated ID.
        Assert.Equal(physicalId, (await Read<JsonElement>(await owner.GetAsync(route))).GetProperty("inventory").GetProperty("physical")[0].GetProperty("id").GetGuid());
        Assert.Equal("Desk", updated.Inventory.Desired.Single(d => d.Id == updated.Inventory.CurrentDesiredId).Data.GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Empty((await Read<RoomConfigurationView>(await owner.GetAsync($"/api/v1/locations/{location}/rooms/{otherId}/configuration"))).Inventory.Desired);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, edit)).StatusCode);
        var invalid = ConfigurationEdit(updated) with { RoomNumber = "SHOULD-ROLLBACK", Assets = new([item with { Quantity = 0 }], updated.Inventory.AssignmentVersion) };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(route, invalid)).StatusCode);
        var unchanged = await Read<RoomConfigurationView>(await owner.GetAsync(route));
        Assert.Equal(updated.Room, unchanged.Room); Assert.Equal(updated.Provenance.Version, unchanged.Provenance!.Version);
        var revised = await Read<RoomConfigurationView>(await owner.PutAsJsonAsync(route, ConfigurationEdit(unchanged) with
        {
            Rent = new(3200000m, Today.AddDays(1), unchanged.ScheduledRent!.Id, unchanged.ScheduledRent.Version),
            Assets = new([], unchanged.Inventory.AssignmentVersion)
        }));
        Assert.Null(revised.Inventory.AssignedTemplateId); Assert.Null(revised.Inventory.CurrentDesiredId);
        Assert.Single(revised.Inventory.Physical);
        Assert.Equal(physicalId, (await Read<JsonElement>(await owner.GetAsync(route))).GetProperty("inventory").GetProperty("physical")[0].GetProperty("id").GetGuid());
        Assert.Equal(3200000m, revised.ScheduledRent!.Rate);
        await using var check = fixture.Factory!.Services.CreateAsyncScope();
        var store = check.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
        var history = await store.HistoryAsync(view.Provenance.Id, "RoomProvenance", default);
        Assert.Equal(25m, history[0].Data.GetProperty("area").GetDecimal());
        var dbCheck = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var policies = await dbCheck.Set<BillingPolicy>().AsNoTracking().Where(p => p.RoomId == roomId).OrderBy(p => p.EffectiveFrom).ToArrayAsync();
        Assert.Equal(2, policies.Length); Assert.Equal(2700000m, policies[0].Rate); Assert.Equal(Today, policies[0].EffectiveTo);
        Assert.Equal(3200000m, policies[1].Rate); Assert.Equal(Today.AddDays(1), policies[1].EffectiveFrom);
    }

    [CompactPostgresFact]
    public async Task RoomTypeRequirementsOnlyApplyToMatchingUncontractedRoomsAndNeverChangeProtectedAssignments()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var draft = SetupDraft();
        var typeKey = draft.RoomTypes[0].Key;
        var states = new[] { ContractStatus.Draft, ContractStatus.PendingSigning, ContractStatus.PendingActivation, ContractStatus.Active, ContractStatus.Draft };
        draft = draft with { Rooms = [.. draft.Rooms, .. states.Select((_, i) => new SetupRoomInput(Guid.NewGuid(), $"P{i}", "1", typeKey, 2700000m))] };
        var location = (await Read<LocationSetupResult>(await Keyed(owner, SetupRoute, draft, Guid.NewGuid()))).Location.Id;
        var source = await Read<LocationSetupSource>(await owner.GetAsync($"{SetupRoute}/source/{location}"));
        var type = source.RoomTypes.Single(d => d.Data.GetProperty("name").GetString() == draft.RoomTypes[0].Name);
        var originalTemplate = source.AssetTemplates.Single();
        Guid eligible, other, legacy;
        var protectedRooms = new List<Guid>();
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var rooms = await db.Set<Room>().Where(r => r.LocationId == location).ToArrayAsync();
            eligible = rooms.Single(r => r.RoomNumber == "101").Id; other = rooms.Single(r => r.RoomNumber == "201").Id;
            var unconfigured = new Room { LocationId = location, RoomNumber = "LEGACY", Capacity = 2, Status = RoomStatus.Available };
            db.Add(unconfigured); legacy = unconfigured.Id;
            for (var i = 0; i < states.Length; i++)
            {
                var room = rooms.Single(r => r.RoomNumber == $"P{i}");
                protectedRooms.Add(room.Id);
                var resident = new Resident { RoomId = room.Id, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic resident " + i };
                var contract = new Contract
                {
                    RoomId = room.Id,
                    OwnerSignerId = w.Owner.Id,
                    RepresentativeResidentId = resident.Id,
                    Kind = i == states.Length - 1 ? ContractKind.Holding : ContractKind.Main,
                    Status = states[i],
                    StartDate = Today,
                    EndDate = Today.AddMonths(6),
                    MonthlyRent = 2700000m,
                    Terms = "Synthetic protected contract",
                    Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = Today }]
                };
                if (contract.Kind == ContractKind.Holding)
                {
                    contract.HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(1);
                    contract.ApprovedAt = DateTimeOffset.UtcNow; contract.ApprovedByUserId = w.Owner.Id;
                    contract.ApprovalReason = "Synthetic holding approval";
                }
                if (contract.Status == ContractStatus.Active)
                {
                    room.Status = RoomStatus.Occupied;
                    contract.ActivatedAt = DateTimeOffset.UtcNow; contract.ActivatedByUserId = w.Owner.Id;
                    contract.TenantUserId = w.Tenant.Id;
                }
                db.AddRange(resident, contract);
            }
            await db.SaveChangesAsync();
        }
        string Route(Guid room) => $"/api/v1/locations/{location}/rooms/{room}/configuration";
        foreach (var room in protectedRooms)
        {
            var locked = await Read<RoomConfigurationView>(await owner.GetAsync(Route(room)));
            Assert.False(locked.CanEdit); Assert.Equal("room_configuration_locked_by_contract", locked.LockReason);
            Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(Route(room), ConfigurationEdit(locked) with { Capacity = 9 })).StatusCode);
            Assert.Equal(originalTemplate.Id, locked.Inventory.AssignedTemplateId);
        }
        var typeRoute = $"/api/v1/locations/{location}/room-defaults/{type.Id}/asset-requirements";
        var request = new RoomAssetRequirementsEdit(type.Version, [new(Guid.NewGuid(), "Table", "Furniture", "Serialized", 1)], true, "Synthetic type update");
        var result = await Read<RoomAssetRequirementsResult>(await owner.PostAsJsonAsync(typeRoute, request));
        Assert.Equal(type.Version + 1, result.Defaults.Version);
        Assert.NotNull(result.Template);
        Assert.Equal("Applied", result.Rooms.Single(r => r.RoomId == eligible).Status);
        Assert.All(protectedRooms, room => Assert.Equal("SkippedNotEligible", result.Rooms.Single(r => r.RoomId == room).Status));
        Assert.DoesNotContain(result.Rooms, r => r.RoomId == other || r.RoomId == legacy);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(typeRoute, request)).StatusCode);
        await Read<AssetSyncRun>(await owner.PostAsync($"/api/v1/asset-templates/{result.Template.Id}/sync", null));
        foreach (var room in protectedRooms)
        {
            var inventory = (await Read<RoomConfigurationView>(await owner.GetAsync(Route(room)))).Inventory;
            Assert.Equal(originalTemplate.Id, inventory.AssignedTemplateId);
            Assert.Single(inventory.Desired); Assert.Empty(inventory.Physical);
        }
        Assert.Equal(result.Template.Id, (await Read<RoomConfigurationView>(await owner.GetAsync(Route(eligible)))).Inventory.AssignedTemplateId);
        Assert.Empty((await Read<RoomConfigurationView>(await owner.GetAsync(Route(other)))).Inventory.Desired);
        Assert.Empty((await Read<RoomConfigurationView>(await owner.GetAsync(Route(legacy)))).Inventory.Desired);
        var created = await Read<BulkRoomResult>(await Keyed(owner, $"/api/v1/locations/{location}/configured-rooms",
            new ConfiguredRoomsInput([new("NEW", "1", type.Id, result.Defaults.Version, 2700000m)], Today), Guid.NewGuid()));
        Assert.Equal(result.Template.Id, (await Read<RoomConfigurationView>(await owner.GetAsync(Route(Assert.Single(created.Rooms).Id)))).Inventory.AssignedTemplateId);
        var cleared = await Read<RoomAssetRequirementsResult>(await owner.PostAsJsonAsync(typeRoute,
            new RoomAssetRequirementsEdit(result.Defaults.Version, [], true, "Synthetic clear")));
        Assert.Null(cleared.Template); Assert.Null((await Read<RoomConfigurationView>(await owner.GetAsync(Route(eligible)))).Inventory.CurrentDesiredId);
        Assert.Equal(originalTemplate.Id, (await Read<RoomConfigurationView>(await owner.GetAsync(Route(protectedRooms[0])))).Inventory.AssignedTemplateId);
    }
}
