using System.Text.Json;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

// Only used within the repository's ledger -> location -> room transaction.
// Business values have command-local identity; writes are explicit per table,
// never reflection-based or delegated to EF's legacy projection writer.
internal sealed class NativeContractMutation(Compact24DbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly Dictionary<Guid, Aggregate> contracts = [];
    private readonly Dictionary<Guid, RoomEntry> rooms = [];
    private readonly Dictionary<Guid, ResidentEntry> residents = [];
    private readonly List<PropertyChange> audits = [];

    private sealed class Aggregate(Contract value, bool added)
    {
        internal Contract Value { get; } = value;
        internal NativeContractSnapshot.ContractState? Original { get; set; } = added ? null : NativeContractSnapshot.Snapshot(value);
        internal Dictionary<Guid, NativeContractSnapshot.ResidentState> Members { get; } =
            added ? [] : value.Residents.ToDictionary(r => r.ResidentId, NativeContractSnapshot.Snapshot);
        internal Dictionary<Guid, NativeContractSnapshot.SignatureState> Signatures { get; } =
            added ? [] : value.Signatures.ToDictionary(s => s.Id, NativeContractSnapshot.Snapshot);
    }

    private sealed record RoomEntry(Room Value, RoomStatus Status, int Version);
    private sealed record ResidentEntry(Resident Value, Guid? RoomId, Guid? TenantId, string? Email);

    internal async Task<Room?> RoomAsync(Guid id, CancellationToken t)
    {
        if (rooms.TryGetValue(id, out var cached)) return cached.Value;
        var row = await db.Set<Native.Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
        if (row is null) return null;
        var location = await db.Set<Native.Location>().AsNoTracking().SingleAsync(l => l.Id == row.LocationId, t);
        var room = NativeRoomLocationPersistence.Read(row);
        room.Location = NativeRoomLocationPersistence.Read(location);
        NativeContractSnapshot.RestoreRoomType(room, location.OperatingSettings);
        rooms.Add(id, new(room, room.Status, room.Version));
        return room;
    }

    internal async Task<Contract?> FindAsync(Guid id, CancellationToken t)
    {
        if (contracts.TryGetValue(id, out var cached)) return cached.Value;
        var value = await NativeContractSnapshot.LoadAsync(db, id, t);
        if (value is null) return null;
        value.Room = await RoomAsync(value.RoomId, t) ?? throw new DbUpdateConcurrencyException("Contract room missing.");
        contracts.Add(id, new(value, false));
        return value;
    }

    internal async Task<Resident[]> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t)
    {
        var missing = ids.Where(id => !residents.ContainsKey(id)).Distinct().ToArray();
        if (missing.Length != 0)
        {
            // Contact/account changes are serialized with the same resident row lock.
            await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM residents WHERE id=ANY({missing}) AND current_room_id={roomId} ORDER BY id FOR UPDATE").ToArrayAsync(t);
            var rows = await db.Set<Native.Resident>().AsNoTracking().Where(r => r.CurrentRoomId == roomId && missing.Contains(r.Id)).ToArrayAsync(t);
            foreach (var row in rows)
            {
                var value = NativeResidentPersistence.Read(row);
                residents.Add(value.Id, new(value, value.RoomId, value.TenantUserId, value.ContactEmail));
            }
        }
        return ids.Distinct().Where(residents.ContainsKey).Select(id => residents[id].Value).Where(r => r.RoomId == roomId).ToArray();
    }

    internal void Add(Contract c)
    {
        if (rooms.TryGetValue(c.RoomId, out var room)) c.Room = room.Value;
        contracts.Add(c.Id, new(c, true));
    }

    internal void Add(ContractSignature s)
    {
        if (!contracts.TryGetValue(s.ContractId, out var contract))
            throw new InvalidOperationException("Signature requires the loaded contract.");
        if (!contract.Value.Signatures.Any(existing => existing.Id == s.Id)) contract.Value.Signatures.Add(s);
    }

    internal void Audit(PropertyChange change) => audits.Add(change);

    internal async Task FlushAsync(CancellationToken t)
    {
        var at = DateTimeOffset.UtcNow;
        foreach (var (id, entry) in residents.ToArray())
        {
            var r = entry.Value;
            if (entry.RoomId == r.RoomId && entry.TenantId == r.TenantUserId && entry.Email == r.ContactEmail) continue;
            await NativeCaptureWrites.ResidentAsync(db, r, false, t);
            residents[id] = new(r, r.RoomId, r.TenantUserId, r.ContactEmail);
        }
        // New roots must exist before their members, signatures, and embedded evidence.
        // Existing version transitions retain the explicit intermediate service flushes.
        foreach (var aggregate in contracts.Values)
        {
            var c = aggregate.Value;
            if (aggregate.Original is null || aggregate.Original != NativeContractSnapshot.Snapshot(c))
            {
                await NativeContractSnapshot.SaveRootAsync(db, c, aggregate.Original?.DraftVersion, at, t);
                aggregate.Original = NativeContractSnapshot.Snapshot(c);
            }
            if (aggregate.Members.Keys.Except(c.Residents.Select(r => r.ResidentId)).Any() ||
                aggregate.Signatures.Keys.Except(c.Signatures.Select(s => s.Id)).Any())
                throw new InvalidOperationException("Contract members and signature attempts cannot be deleted.");
            foreach (var member in c.Residents)
            {
                member.ContractId = c.Id;
                var added = !aggregate.Members.TryGetValue(member.ResidentId, out var old);
                var snapshot = NativeContractSnapshot.Snapshot(member);
                if (added || old != snapshot)
                {
                    await NativeContractSnapshot.SaveMemberAsync(db, member, added, t);
                    aggregate.Members[member.ResidentId] = snapshot;
                }
            }
            foreach (var signature in c.Signatures)
            {
                var added = !aggregate.Signatures.TryGetValue(signature.Id, out var old);
                if (added || old != NativeContractSnapshot.Snapshot(signature))
                {
                    await NativeContractSnapshot.SaveSignatureAsync(db, signature, added, at, t);
                    aggregate.Signatures[signature.Id] = NativeContractSnapshot.Snapshot(signature);
                }
            }
        }
        foreach (var (id, entry) in rooms.ToArray())
        {
            var r = entry.Value;
            if (r.Status == entry.Status && r.Version == entry.Version) continue;
            r.Stamp(at, false);
            var history = JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                recordType = "Room",
                recordKey = id.ToString(),
                deleted = false,
                state = new
                {
                    r.Id,
                    r.LocationId,
                    r.RoomNumber,
                    r.RoomTypeId,
                    r.Floor,
                    r.Capacity,
                    r.Status,
                    r.Version,
                    r.CreatedAt,
                    r.UpdatedAt
                }
            }, Json);
            var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE rooms SET status={(short)r.Status},version={r.Version},history=history||jsonb_build_array(CAST({history} AS jsonb))
                WHERE id={id} AND version={entry.Version}
                """, t);
            if (affected != 1) throw new DbUpdateConcurrencyException("Room status changed.");
            rooms[id] = new(r, r.Status, r.Version);
        }
        foreach (var audit in audits)
        {
            var data = JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                recordType = "PropertyChange",
                state = audit,
                audienceRole = (string?)null,
                category = (string?)null,
                succeeded = (bool?)null,
                sessionId = (Guid?)null,
                targetUserId = (Guid?)null
            }, Json);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO notifications(id,record_kind,actor_user_id,location_id,event_key,notification_type,
                    related_entity_type,related_entity_id,event_at,event_data)
                VALUES({audit.Id},'AUDIT',{audit.ActorId},{audit.LocationId},{"PropertyChange:" + audit.Id},{audit.Action},
                    {audit.TargetType},{audit.TargetId},{audit.OccurredAt},CAST({data} AS jsonb))
                """, t);
        }
        audits.Clear();
    }
}
