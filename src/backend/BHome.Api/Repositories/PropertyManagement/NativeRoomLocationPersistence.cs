using System.Text.Json;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal static class NativeRoomLocationPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record LocationState(Guid Id, Guid? ChainId, string Name, string Address, bool IsActive,
        int Version, string ContractSettings, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record RoomState(Guid Id, Guid LocationId, string RoomNumber, Guid? RoomTypeId,
        string? Floor, int Capacity, RoomStatus Status, int Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record HistoryEntry<T>(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, T State);

    private static JsonElement EmptyObject() => JsonSerializer.SerializeToElement(new { }, Json);
    private static JsonElement EmptyArray() => JsonSerializer.SerializeToElement(Array.Empty<JsonElement>(), Json);
    private static JsonElement LastState(JsonElement history, string kind)
    {
        var entry = history.EnumerateArray().Reverse().FirstOrDefault(h =>
            h.ValueKind == JsonValueKind.Object && h.TryGetProperty("recordType", out var type) &&
            type.ValueKind == JsonValueKind.String && type.GetString() == kind);
        return entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("state", out var value) ? value : default;
    }
    private static DateTimeOffset Timestamp(JsonElement state, string name) =>
        state.ValueKind == JsonValueKind.Object && state.TryGetProperty(name, out var value) &&
        value.ValueKind != JsonValueKind.Null ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
    private static Guid? NullableGuid(JsonElement state, string name) =>
        state.ValueKind == JsonValueKind.Object && state.TryGetProperty(name, out var value) &&
        value.ValueKind != JsonValueKind.Null ? value.GetGuid() : null;
    private static JsonElement Append<T>(JsonElement history, Guid id, string kind, T state) =>
        JsonSerializer.SerializeToElement(history.EnumerateArray().Append(
            JsonSerializer.SerializeToElement(new HistoryEntry<T>(1, kind, id.ToString(), false, state), Json)), Json);

    internal static Location Read(Native.Location row)
    {
        var state = LastState(row.History, "Location");
        var location = Location.Rehydrate(row.Id, Timestamp(state, "createdAt"), Timestamp(state, "updatedAt"));
        location.ChainId = NullableGuid(state, "chainId");
        location.Name = row.Name;
        location.Address = row.Address;
        location.IsActive = row.IsActive;
        location.Version = row.Version;
        location.ContractSettings = row.OperatingSettings.TryGetProperty("contractSettings", out var settings)
            ? settings.GetRawText() : "[]";
        return location;
    }
    internal static Room Read(Native.Room row)
    {
        var state = LastState(row.History, "Room");
        var room = Room.Rehydrate(row.Id, Timestamp(state, "createdAt"), Timestamp(state, "updatedAt"));
        room.LocationId = row.LocationId;
        room.RoomNumber = row.RoomNumber;
        room.RoomTypeId = NullableGuid(state, "roomTypeId");
        room.Floor = row.Floor;
        room.Capacity = row.Capacity;
        room.Status = (RoomStatus)row.Status;
        room.Version = row.Version;
        return room;
    }
    internal static async Task StageAsync(Compact24DbContext db, Location location, int? expectedVersion,
        DateTimeOffset now, CancellationToken t)
    {
        Native.Location row;
        if (expectedVersion is null)
        {
            row = new Native.Location
            {
                Id = location.Id, StaffAssignments = EmptyArray(), OperatingSettings = EmptyObject(),
                PublicProfile = EmptyObject(), History = EmptyArray()
            };
            db.Add(row);
        }
        else
        {
            row = await db.Set<Native.Location>().AsTracking().SingleOrDefaultAsync(l => l.Id == location.Id, t)
                ?? throw new DbUpdateConcurrencyException("Location no longer exists.");
            if (row.Version != expectedVersion.Value)
            {
                db.Entry(row).State = EntityState.Detached;
                throw new DbUpdateConcurrencyException("Location version changed.");
            }
        }
        location.Stamp(now, expectedVersion is null);
        row.Name = location.Name;
        row.Address = location.Address;
        row.IsActive = location.IsActive;
        row.Version = location.Version;
        var settings = row.OperatingSettings.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
        using (var document = JsonDocument.Parse(location.ContractSettings))
            settings["contractSettings"] = document.RootElement.Clone();
        row.OperatingSettings = JsonSerializer.SerializeToElement(settings, Json);
        row.History = Append(row.History, location.Id, "Location", new LocationState(location.Id, location.ChainId,
            location.Name, location.Address, location.IsActive, location.Version, location.ContractSettings,
            location.CreatedAt, location.UpdatedAt));
    }
    internal static async Task StageAsync(Compact24DbContext db, Room room, int? expectedVersion,
        DateTimeOffset now, CancellationToken t)
    {
        Native.Room row;
        if (expectedVersion is null)
        {
            row = new Native.Room
            {
                Id = room.Id, LocationId = room.LocationId, BillingRepresentatives = EmptyArray(),
                PublicProfile = EmptyObject(), History = EmptyArray()
            };
            db.Add(row);
        }
        else
        {
            row = await db.Set<Native.Room>().AsTracking().SingleOrDefaultAsync(r => r.Id == room.Id, t)
                ?? throw new DbUpdateConcurrencyException("Room no longer exists.");
            if (row.Version != expectedVersion.Value)
            {
                db.Entry(row).State = EntityState.Detached;
                throw new DbUpdateConcurrencyException("Room version changed.");
            }
        }
        room.Stamp(now, expectedVersion is null);
        row.LocationId = room.LocationId;
        row.RoomNumber = room.RoomNumber;
        row.Floor = room.Floor;
        row.Capacity = checked((short)room.Capacity);
        row.Status = (short)room.Status;
        row.Version = room.Version;
        row.History = Append(row.History, room.Id, "Room", new RoomState(room.Id, room.LocationId, room.RoomNumber,
            room.RoomTypeId, room.Floor, room.Capacity, room.Status, room.Version, room.CreatedAt, room.UpdatedAt));
    }
}
