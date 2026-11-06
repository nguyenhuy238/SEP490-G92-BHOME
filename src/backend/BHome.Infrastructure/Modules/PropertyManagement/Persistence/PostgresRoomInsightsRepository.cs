using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PostgresRoomInsightsRepository(BHomePersistenceContext db) : IRoomInsightsRepository
{
    public async Task<RoomReadinessEvidence> ReadinessAsync(Guid roomId, Guid? contractId,
        DateOnly effectiveOn, CancellationToken token)
    {
        var room = await db.Set<Room>().AsNoTracking().Where(x => x.Id == roomId).Select(x => new
        {
            x.LocationId,
            LocationActive = x.Location.IsActive,
            x.Status,
            x.Capacity
        }).SingleAsync(token);
        var obligations = await Obligations(roomId, effectiveOn, token);
        var hasRent = await db.Set<BillingPolicy>().AsNoTracking().AnyAsync(x =>
            x.LocationId == room.LocationId && x.Category == ChargeCategory.Rent && x.ChargeCode == "RENT" &&
            (x.RoomId == roomId || x.RoomId == null && x.RoomTypeId == null) && x.EffectiveFrom <= effectiveOn &&
            (x.EffectiveTo == null || x.EffectiveTo >= effectiveOn), token);
        var meters = await db.Set<Meter>().AsNoTracking().Where(x => x.RoomId == roomId && x.IsActive)
            .Select(x => new { x.Id, x.UtilityType }).ToArrayAsync(token);
        var ids = meters.Select(x => x.Id).ToArray();
        var baselines = await (from reading in db.Set<MeterReading>().AsNoTracking()
                               join task in db.Set<OperationalTask>().AsNoTracking() on reading.TaskId equals task.Id
                               where ids.Contains(reading.MeterId) && task.Purpose == ReadingPurpose.Initial &&
                                     task.Status == MeterTaskStatus.Completed && reading.ConfirmedAt != default
                               select reading.MeterId).Distinct().ToArrayAsync(token);
        var currentOccupants = await (from c in db.Set<Contract>().AsNoTracking()
                                      from cr in c.Residents
                                      where c.RoomId == roomId && c.Status == ContractStatus.Active && cr.ResidenceFrom <= effectiveOn &&
                                            (cr.ResidenceTo == null || cr.ResidenceTo >= effectiveOn)
                                      select cr.ResidentId).Distinct().CountAsync(token);
        var blockingAsset = await db.Set<Asset>().AsNoTracking().AnyAsync(x => x.RoomId == roomId &&
            (x.Status == AssetStatus.NeedsRepair || x.Status == AssetStatus.UnderRepair), token);

        MoveInContractEvidence? contract = null;
        if (contractId.HasValue)
        {
            var found = await db.Set<Contract>().AsNoTracking().Where(x => x.Id == contractId.Value)
                .Select(x => new
                {
                    x.RoomId,
                    x.Status,
                    x.StartDate,
                    x.EndDate,
                    x.RepresentativeResidentId,
                    x.PreviousContractId,
                    Residents = x.Residents.Count,
                    ResidentIds = x.Residents.Select(r => r.ResidentId).ToArray(),
                    Verified = x.Residents.Count(r => db.Set<Resident>().Any(p => p.Id == r.ResidentId &&
                        p.RoomId == roomId && p.VerificationStatus == IdentityVerificationStatus.Verified)),
                    RepresentativeVerified = x.Residents.Any(r => r.ResidentId == x.RepresentativeResidentId &&
                        r.Role == ResidentType.Representative && db.Set<Resident>().Any(p => p.Id == r.ResidentId &&
                            p.RoomId == roomId && p.VerificationStatus == IdentityVerificationStatus.Verified))
                }).SingleOrDefaultAsync(token);
            if (found is null) contract = new(false, false, false, false, 0, 0, false, false, false);
            else
            {
                var others = db.Set<Contract>().AsNoTracking().Where(x => x.RoomId == roomId &&
                    x.Id != contractId && x.Id != found.PreviousContractId && x.Status == ContractStatus.Active &&
                    x.StartDate <= found.EndDate && x.EndDate >= found.StartDate);
                var conflictingResident = await others.AnyAsync(x =>
                    x.Residents.Any(r => found.ResidentIds.Contains(r.ResidentId)), token);
                currentOccupants = await others.SelectMany(x => x.Residents)
                    .Where(x => x.ResidenceFrom <= effectiveOn && (x.ResidenceTo == null || x.ResidenceTo >= effectiveOn))
                    .Select(x => x.ResidentId).Distinct().CountAsync(token);
                var handover = await db.Set<ContractHandover>().AsNoTracking().AnyAsync(x =>
                    x.ContractId == contractId && x.Status == ContractHandoverStatus.Confirmed, token);
                contract = new(true, found.RoomId == roomId, found.Status == ContractStatus.PendingActivation,
                    found.StartDate <= effectiveOn && found.EndDate >= effectiveOn, found.Residents, found.Verified,
                    found.RepresentativeVerified, conflictingResident, handover);
            }
        }
        bool Has(UtilityType type) => meters.Any(x => x.UtilityType == type);
        bool Baseline(UtilityType type) => meters.Where(x => x.UtilityType == type).Any(x => baselines.Contains(x.Id));
        return new(room.LocationActive, room.Status, room.Capacity, obligations, hasRent,
            currentOccupants, Has(UtilityType.Electricity), Has(UtilityType.Water), Baseline(UtilityType.Electricity),
            Baseline(UtilityType.Water), blockingAsset, contract);
    }

    private async Task<RoomObligations> Obligations(Guid roomId, DateOnly today, CancellationToken token)
    {
        var contracts = db.Set<Contract>().Where(c => c.RoomId == roomId);
        var residents = await db.Set<Resident>().AnyAsync(r => r.RoomId == roomId, token);
        var occupancy = await contracts.AnyAsync(c => c.Status == ContractStatus.Active && c.Residents.Any(r =>
            r.ResidenceFrom <= today && (r.ResidenceTo == null || r.ResidenceTo >= today)), token);
        var active = await contracts.AnyAsync(c => c.Status == ContractStatus.Active, token);
        var pending = await contracts.AnyAsync(c =>
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning ||
             c.Status == ContractStatus.PendingActivation) &&
            (c.Signatures.Any(s => s.Status == SignatureStatus.Signed && s.SignedAt != null &&
                s.SignedObjectKey != null && s.SignedObjectKey != "" && s.SignedHash != null && s.SignedHash != "") ||
             db.Set<DepositVerification>().Any(d => d.ContractId == c.Id && d.Amount > 0)), token);
        return new(residents, occupancy, active, pending);
    }

    public async Task<RoomHistoryReadResult> HistoryAsync(Guid roomId, RoomHistoryQuery query,
        DateTimeOffset? fromInclusive, DateTimeOffset? toExclusive, CancellationToken token)
    {
        var property = await db.Set<PropertyChange>().AsNoTracking().Where(x => x.TargetId == roomId &&
                x.TargetType == nameof(Room) && (!fromInclusive.HasValue || x.OccurredAt >= fromInclusive) &&
                (!toExclusive.HasValue || x.OccurredAt < toExclusive))
            .Select(x => new RoomHistoryEvent(x.Id, "RoomStatusOrConfiguration", "PropertyAudit", x.OccurredAt,
                null, x.Action)).ToArrayAsync(token);
        var contracts = await db.Set<Contract>().AsNoTracking().Where(x => x.RoomId == roomId)
            .Select(x => new { x.Id, x.ActivatedAt, x.ActualEndDate, x.UpdatedAt, x.Status }).ToArrayAsync(token);
        var occupancy = await (from c in db.Set<Contract>().AsNoTracking()
                               from r in c.Residents
                               where c.RoomId == roomId
                               select new { c.Id, r.ResidentId, r.ResidenceFrom, r.ResidenceTo }).ToArrayAsync(token);
        List<RoomHistoryEvent> events = [.. property];
        foreach (var c in contracts)
        {
            if (c.ActivatedAt is { } at && InRange(at, fromInclusive, toExclusive))
                events.Add(new(StableId(c.Id, "contract-activated"), "ContractActivated", "Contract", at,
                    c.Id, "A Main Tenancy Contract was activated."));
            if (c.Status is ContractStatus.Terminated or ContractStatus.Superseded && c.ActualEndDate.HasValue)
            {
                var endedAt = BusinessInstant(c.ActualEndDate.Value);
                if (InRange(endedAt, fromInclusive, toExclusive)) events.Add(new(StableId(c.Id, "contract-ended"),
                    "ContractEnded", "Contract", endedAt, c.Id, "A Main Tenancy Contract occupancy period ended."));
            }
        }
        foreach (var o in occupancy)
        {
            var start = BusinessInstant(o.ResidenceFrom);
            if (InRange(start, fromInclusive, toExclusive)) events.Add(new(StableId(o.Id, o.ResidentId, "occupancy-start"),
                "OccupancyStarted", "ContractResident", start, o.Id, "A resident occupancy interval started."));
            if (o.ResidenceTo is { } end)
            {
                var at = BusinessInstant(end.AddDays(1));
                if (InRange(at, fromInclusive, toExclusive)) events.Add(new(StableId(o.Id, o.ResidentId, "occupancy-end"),
                    "OccupancyEnded", "ContractResident", at, o.Id, "A resident occupancy interval ended."));
            }
        }
        if (!string.IsNullOrWhiteSpace(query.EventType))
            events = events.Where(x => string.Equals(x.EventType, query.EventType.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        var ordered = events.OrderByDescending(x => x.OccurredAt).ThenBy(x => x.Id).ToArray();
        var offset = checked((query.Page - 1) * query.PageSize);
        var page = ordered.Skip(offset).Take(query.PageSize).ToArray();
        var complete = await db.Set<PropertyChange>().AsNoTracking().AnyAsync(x => x.TargetId == roomId &&
            x.TargetType == nameof(Room) && x.Action == "Created", token);
        return new(page, ordered.Length, complete);
    }

    public async Task<OccupancyReadModel> OccupancyAsync(Guid locationId, DateOnly today, DateOnly? from,
        DateOnly? to, CancellationToken token)
    {
        var rooms = await db.Set<Room>().AsNoTracking().Where(x => x.LocationId == locationId)
            .Select(x => new { x.Id, x.Status }).ToArrayAsync(token);
        var roomIds = rooms.Select(x => x.Id).ToArray();
        var verifiedRooms = await (from c in db.Set<Contract>().AsNoTracking()
                                   from cr in c.Residents
                                   join resident in db.Set<Resident>().AsNoTracking() on cr.ResidentId equals resident.Id
                                   where roomIds.Contains(c.RoomId) && c.Status == ContractStatus.Active && cr.ResidenceFrom <= today &&
                                         (cr.ResidenceTo == null || cr.ResidenceTo >= today) &&
                                         resident.VerificationStatus == IdentityVerificationStatus.Verified
                                   select c.RoomId).Distinct().CountAsync(token);
        var activeRooms = await db.Set<Contract>().AsNoTracking().Where(x => roomIds.Contains(x.RoomId) &&
            x.Status == ContractStatus.Active).Select(x => x.RoomId).Distinct().CountAsync(token);
        var snapshot = new OccupancySnapshot(rooms.Length,
            rooms.Count(x => x.Status == RoomStatus.Available), rooms.Count(x => x.Status == RoomStatus.Occupied),
            rooms.Count(x => x.Status == RoomStatus.OnHold), rooms.Count(x => x.Status == RoomStatus.Unavailable),
            verifiedRooms, activeRooms);
        if (!from.HasValue)
            return new(snapshot, roomIds, [], [], [], false);

        var propertyChanges = await db.Set<PropertyChange>().AsNoTracking().Where(x =>
                (roomIds.Contains(x.TargetId) && x.TargetType == nameof(Room) ||
                 x.TargetId == locationId && x.TargetType == "Location") && x.OccurredAt < BusinessInstant(to!.Value.AddDays(1)))
            .Select(x => new { x.TargetId, x.TargetType, x.Action, x.After, x.OccurredAt }).ToArrayAsync(token);
        var roomStatus = propertyChanges.Where(x => x.TargetType == nameof(Room)).Select(x =>
            TryStatus(x.After, out var status) ? new StatusEvidence(x.TargetId, VietnamDate(x.OccurredAt), x.OccurredAt, status) : null)
            .Where(x => x is not null).Cast<StatusEvidence>().ToArray();
        var locationStatus = propertyChanges.Where(x => x.TargetType == "Location").Select(x =>
            TryActive(x.After, out var active) ? new StatusEvidence(x.TargetId, VietnamDate(x.OccurredAt), x.OccurredAt, active ? 1 : 0) : null)
            .Where(x => x is not null).Cast<StatusEvidence>().ToArray();
        var intervals = await (from c in db.Set<Contract>().AsNoTracking()
                               from cr in c.Residents
                               where roomIds.Contains(c.RoomId) && c.ActivatedAt != null &&
                                     c.Status != ContractStatus.Draft && c.Status != ContractStatus.PendingSigning &&
                                     c.Status != ContractStatus.PendingActivation && c.Status != ContractStatus.Cancelled
                               select new OccupancyInterval(c.RoomId,
                                   cr.ResidenceFrom < c.StartDate ? c.StartDate : cr.ResidenceFrom,
                                   cr.ResidenceTo != null && cr.ResidenceTo < (c.ActualEndDate ?? c.EndDate)
                                       ? cr.ResidenceTo.Value : c.ActualEndDate ?? c.EndDate)).ToArrayAsync(token);
        var complete = propertyChanges.Any(x => x.TargetId == locationId && x.TargetType == "Location" &&
            x.Action == "Created" && VietnamDate(x.OccurredAt) <= from) && roomIds.All(id =>
            propertyChanges.Any(x => x.TargetId == id && x.TargetType == nameof(Room) && x.Action == "Created" &&
                                     VietnamDate(x.OccurredAt) <= from));
        return new(snapshot, roomIds, roomStatus, locationStatus, intervals, complete);
    }

    private static bool InRange(DateTimeOffset value, DateTimeOffset? from, DateTimeOffset? to) =>
        (!from.HasValue || value >= from) && (!to.HasValue || value < to);
    private static DateTimeOffset BusinessInstant(DateOnly date) =>
        new(date.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7));
    private static DateOnly VietnamDate(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(instant, "Asia/Ho_Chi_Minh").DateTime);
    private static Guid StableId(Guid id, string kind) => StableId(id, Guid.Empty, kind);
    private static Guid StableId(Guid first, Guid second, string kind)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{first:N}:{second:N}:{kind}"));
        return new Guid(bytes.AsSpan(0, 16));
    }
    private static bool TryStatus(string json, out int status) => TryValue(json, "status", out status);
    private static bool TryActive(string json, out bool active)
    {
        active = false;
        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("isActive", out var value) &&
                !document.RootElement.TryGetProperty("IsActive", out value)) return false;
            active = value.GetBoolean(); return true;
        }
        catch (JsonException) { return false; }
    }
    private static bool TryValue(string json, string name, out int value)
    {
        value = 0;
        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty(name, out var element) &&
                !document.RootElement.TryGetProperty(char.ToUpperInvariant(name[0]) + name[1..], out element)) return false;
            if (element.ValueKind == JsonValueKind.Number) return element.TryGetInt32(out value);
            return Enum.TryParse<RoomStatus>(element.GetString(), out var parsed) && (value = (int)parsed) >= 0;
        }
        catch (JsonException) { return false; }
    }
}
