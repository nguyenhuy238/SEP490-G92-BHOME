using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PostgresRoomInsightsRepository(BHomePersistenceContext db) : IRoomInsightsRepository
{
    public async Task<RoomReadinessEvidence> ReadinessAsync(Guid roomId, Guid? contractId,
        DateOnly effectiveOn, CancellationToken token)
    {
        if (db is Compact24DbContext compact)
            return await NativeReadinessAsync(compact, roomId, contractId, effectiveOn, token);
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
        var blockingAsset = await db.Set<Asset>().AsNoTracking().AnyAsync(x => x.RoomId == roomId &&
            (x.Status == AssetStatus.NeedsRepair || x.Status == AssetStatus.UnderRepair), token);
        if (contractId is null)
            return new(room.LocationActive, room.Status, room.Capacity, obligations, hasRent,
                0, false, false, false, false, blockingAsset, null);

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
                                      where c.RoomId == roomId && c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && cr.ResidenceFrom <= effectiveOn &&
                                            (cr.ResidenceTo == null || cr.ResidenceTo >= effectiveOn)
                                      select cr.ResidentId).Distinct().CountAsync(token);
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

    private static async Task<RoomReadinessEvidence> NativeReadinessAsync(Compact24DbContext compact, Guid roomId,
        Guid? contractId, DateOnly effectiveOn, CancellationToken token)
    {
        var rooms = compact.Set<Native.Room>().AsNoTracking();
        var room = await (from r in rooms
                          join l in compact.Set<Native.Location>().AsNoTracking() on r.LocationId equals l.Id
                          where r.Id == roomId
                          select new { r.LocationId, LocationActive = l.IsActive, Status = (RoomStatus)r.Status, r.Capacity })
            .SingleAsync(token);
        var obligations = await PostgresPropertyRepository.NativeObligationsAsync(compact,
            rooms.Where(r => r.Id == roomId).Select(r => r.Id), effectiveOn, token, includeHistoricalResidents: true);
        // Room-type scope is historical JSON metadata; exclude it for location-wide rent.
        var hasRent = await compact.Database.SqlQuery<bool>($"""
            SELECT EXISTS (
                SELECT 1 FROM billing_policies p
                LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                WHERE p.location_id={room.LocationId} AND p.category={(short)ChargeCategory.Rent} AND p.charge_code='RENT'
                  AND (p.room_id={roomId} OR (p.room_id IS NULL AND s.data->>'roomTypeId' IS NULL))
                  AND p.effective_from<={effectiveOn} AND (p.effective_to IS NULL OR p.effective_to>={effectiveOn})
            ) AS "Value"
            """).SingleAsync(token);
        var blockingAsset = await compact.Set<Native.Asset>().AsNoTracking().AnyAsync(a => a.RoomId == roomId &&
            (a.Status == (short)AssetStatus.NeedsRepair || a.Status == (short)AssetStatus.UnderRepair), token);
        if (contractId is null)
            return new(room.LocationActive, room.Status, room.Capacity, obligations, hasRent,
                0, false, false, false, false, blockingAsset, null);

        var meters = await compact.Set<Native.Meter>().AsNoTracking().Where(x => x.RoomId == roomId && x.IsActive)
            .Select(x => new { x.Id, x.UtilityType }).ToArrayAsync(token);
        var ids = meters.Select(x => x.Id).ToArray();
        // The legacy task's purpose comes from task_data.state; keep that source and
        // its default Initial value rather than replacing it with the reading purpose.
        var baselines = await compact.Database.SqlQuery<Guid>($"""
            SELECT DISTINCT mr.meter_id AS "Value" FROM meter_readings mr
            JOIN operational_tasks task ON task.id=mr.operational_task_id
            WHERE mr.meter_id=ANY({ids}) AND task.task_type IN ('METER_READ','GENERAL')
              AND COALESCE((task.task_data->'state'->>'purpose')::int,0)={(int)ReadingPurpose.Initial}
              AND task.status={(int)MeterTaskStatus.Completed}::text AND mr.confirmed_at<>{default(DateTimeOffset)}
            """).ToArrayAsync(token);
        var contracts = compact.Set<Native.Contract>().AsNoTracking();
        var members = compact.Set<Native.ContractResident>().AsNoTracking();
        var residents = compact.Set<Native.Resident>().AsNoTracking();
        var currentOccupants = await (from c in contracts
                                      join cr in members on c.Id equals cr.ContractId
                                      where c.RoomId == roomId && c.ContractType != "HOLDING" &&
                                            c.Status == (short)ContractStatus.Active && cr.ResidenceFrom <= effectiveOn &&
                                            (cr.ResidenceTo == null || cr.ResidenceTo >= effectiveOn)
                                      select cr.ResidentId).Distinct().CountAsync(token);
        var found = await contracts.Where(x => x.Id == contractId.Value)
            .Select(x => new { x.Id, x.RoomId, x.Status, x.StartDate, x.EndDate, x.RepresentativeResidentId, x.PreviousContractId })
            .SingleOrDefaultAsync(token);
        MoveInContractEvidence contract;
        if (found is null) contract = new(false, false, false, false, 0, 0, false, false, false);
        else
        {
            var contractMembers = members.Where(r => r.ContractId == found.Id);
            var residentIds = await contractMembers.Select(r => r.ResidentId).ToArrayAsync(token);
            var verifiedMembers = from member in contractMembers
                                  join person in residents on member.ResidentId equals person.Id
                                  where person.CurrentRoomId == roomId && person.VerificationStatus == (short)IdentityVerificationStatus.Verified
                                  select member;
            var verified = await verifiedMembers.CountAsync(token);
            var representativeVerified = await verifiedMembers.AnyAsync(r => r.ResidentId == found.RepresentativeResidentId &&
                r.ResidentRole == (short)ResidentType.Representative, token);
            var otherMembers = from c in contracts
                               join member in members on c.Id equals member.ContractId
                               where c.RoomId == roomId && c.Id != contractId && c.Id != found.PreviousContractId &&
                                     c.Status == (short)ContractStatus.Active && c.StartDate <= found.EndDate && c.EndDate >= found.StartDate
                               select member;
            var conflictingResident = await otherMembers.AnyAsync(r => residentIds.Contains(r.ResidentId), token);
            currentOccupants = await otherMembers.Where(r => r.ResidenceFrom <= effectiveOn &&
                (r.ResidenceTo == null || r.ResidenceTo >= effectiveOn)).Select(r => r.ResidentId).Distinct().CountAsync(token);
            var handover = await compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM contracts c
                    WHERE (c.handover->'current'->>'contractId')::uuid={contractId.Value}
                      AND (c.handover->'current'->>'status')::int={(int)ContractHandoverStatus.Confirmed}) AS "Value"
                """).SingleAsync(token);
            contract = new(true, found.RoomId == roomId, found.Status == (short)ContractStatus.PendingActivation,
                found.StartDate <= effectiveOn && found.EndDate >= effectiveOn, residentIds.Length, verified,
                representativeVerified, conflictingResident, handover);
        }
        bool Has(UtilityType type) => meters.Any(x => x.UtilityType == (short)type);
        bool Baseline(UtilityType type) => meters.Any(x => x.UtilityType == (short)type && baselines.Contains(x.Id));
        return new(room.LocationActive, room.Status, room.Capacity, obligations, hasRent,
            currentOccupants, Has(UtilityType.Electricity), Has(UtilityType.Water), Baseline(UtilityType.Electricity),
            Baseline(UtilityType.Water), blockingAsset, contract);
    }

    private async Task<RoomObligations> Obligations(Guid roomId, DateOnly today, CancellationToken token)
    {
        var contracts = db.Set<Contract>().Where(c => c.RoomId == roomId);
        var residents = await db.Set<Resident>().AnyAsync(r => r.RoomId == roomId, token);
        var occupancy = await contracts.AnyAsync(c => c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.Residents.Any(r =>
            r.ResidenceFrom <= today && (r.ResidenceTo == null || r.ResidenceTo >= today)), token);
        var active = await contracts.AnyAsync(c => c.Status == ContractStatus.Active, token);
        var pending = await PostgresPropertyRepository.BindingPendingContractsAsync(db, contracts, token);
        return new(residents, occupancy, active, pending);
    }

    public async Task<RoomHistoryReadResult> HistoryAsync(Guid roomId, RoomHistoryQuery query,
        DateTimeOffset? fromInclusive, DateTimeOffset? toExclusive, CancellationToken token)
    {
        var audit = PropertyAuditRows();
        var property = await audit.Where(x => x.TargetId == roomId &&
                x.TargetType == nameof(Room) && (!fromInclusive.HasValue || x.OccurredAt >= fromInclusive) &&
                (!toExclusive.HasValue || x.OccurredAt < toExclusive))
            .Select(x => new RoomHistoryEvent(x.Id, "RoomStatusOrConfiguration", "PropertyAudit", x.OccurredAt,
                null, x.Action)).ToArrayAsync(token);
        var contracts = db is Compact24DbContext compact
            ? await compact.Database.SqlQuery<ContractHistoryRow>($"""
                SELECT c.id AS "Id", CASE c.contract_type WHEN 'HOLDING' THEN 2 WHEN 'RENEWAL' THEN 1
                    WHEN 'ADDENDUM' THEN 3 ELSE 0 END AS "Kind", c.activated_at AS "ActivatedAt",
                    c.actual_end_date AS "ActualEndDate", COALESCE((s.data->>'updatedAt')::timestamptz,
                        '1970-01-01Z'::timestamptz) AS "UpdatedAt", c.status::int AS "Status"
                FROM contracts c
                LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='Contract' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                WHERE c.room_id={roomId}
                """).ToArrayAsync(token)
            : await db.Set<Contract>().AsNoTracking().Where(x => x.RoomId == roomId)
                .Select(x => new ContractHistoryRow(x.Id, x.Kind, x.ActivatedAt, x.ActualEndDate, x.UpdatedAt, x.Status)).ToArrayAsync(token);
        var occupancy = db is Compact24DbContext native
            ? await (from c in native.Set<Native.Contract>().AsNoTracking()
                     join r in native.Set<Native.ContractResident>().AsNoTracking() on c.Id equals r.ContractId
                     where c.RoomId == roomId
                     select new { c.Id, r.ResidentId, r.ResidenceFrom, r.ResidenceTo }).ToArrayAsync(token)
            : await (from c in db.Set<Contract>().AsNoTracking()
                               from r in c.Residents
                               where c.RoomId == roomId
                               select new { c.Id, r.ResidentId, r.ResidenceFrom, r.ResidenceTo }).ToArrayAsync(token);
        List<RoomHistoryEvent> events = [.. property];
        foreach (var c in contracts)
        {
            if (c.ActivatedAt is { } at && InRange(at, fromInclusive, toExclusive))
                events.Add(new(StableId(c.Id, "contract-activated"), c.Kind == ContractKind.Holding ? "HoldingActivated" : "ContractActivated", "Contract", at,
                    c.Id, c.Kind == ContractKind.Holding ? "A Holding Contract was activated." : "A Main Tenancy Contract was activated."));
            if (c.Kind == ContractKind.Holding && c.Status is ContractStatus.Expired or ContractStatus.Cancelled or ContractStatus.Converted && InRange(c.UpdatedAt, fromInclusive, toExclusive))
                events.Add(new(StableId(c.Id, "holding-" + c.Status), "Holding" + c.Status, "Contract", c.UpdatedAt,
                    c.Id, $"A Holding Contract became {c.Status}."));
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
        var complete = await audit.AnyAsync(x => x.TargetId == roomId &&
            x.TargetType == nameof(Room) && x.Action == "Created", token);
        return new(page, ordered.Length, complete);
    }

    public async Task<OccupancyReadModel> OccupancyAsync(Guid locationId, DateOnly today, DateOnly? from,
        DateOnly? to, CancellationToken token)
    {
        var rooms = db is Compact24DbContext compact
            ? await compact.Set<Native.Room>().AsNoTracking().Where(x => x.LocationId == locationId)
                .Select(x => new { x.Id, Status = (RoomStatus)x.Status }).ToArrayAsync(token)
            : await db.Set<Room>().AsNoTracking().Where(x => x.LocationId == locationId)
                .Select(x => new { x.Id, x.Status }).ToArrayAsync(token);
        var roomIds = rooms.Select(x => x.Id).ToArray();
        var verifiedRooms = db is Compact24DbContext native
            ? await (from c in native.Set<Native.Contract>().AsNoTracking()
                     join cr in native.Set<Native.ContractResident>().AsNoTracking() on c.Id equals cr.ContractId
                     join resident in native.Set<Native.Resident>().AsNoTracking() on cr.ResidentId equals resident.Id
                     where roomIds.Contains(c.RoomId) && c.ContractType != "HOLDING" &&
                           c.Status == (short)ContractStatus.Active && cr.ResidenceFrom <= today &&
                           (cr.ResidenceTo == null || cr.ResidenceTo >= today) &&
                           resident.VerificationStatus == (short)IdentityVerificationStatus.Verified
                     select c.RoomId).Distinct().CountAsync(token)
            : await (from c in db.Set<Contract>().AsNoTracking()
                                   from cr in c.Residents
                                   join resident in db.Set<Resident>().AsNoTracking() on cr.ResidentId equals resident.Id
                                   where roomIds.Contains(c.RoomId) && c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && cr.ResidenceFrom <= today &&
                                         (cr.ResidenceTo == null || cr.ResidenceTo >= today) &&
                                         resident.VerificationStatus == IdentityVerificationStatus.Verified
                                   select c.RoomId).Distinct().CountAsync(token);
        var activeRooms = db is Compact24DbContext nativeContracts
            ? await nativeContracts.Set<Native.Contract>().AsNoTracking().Where(x => roomIds.Contains(x.RoomId) &&
                x.ContractType != "HOLDING" && x.Status == (short)ContractStatus.Active).Select(x => x.RoomId).Distinct().CountAsync(token)
            : await db.Set<Contract>().AsNoTracking().Where(x => roomIds.Contains(x.RoomId) &&
            x.Kind != ContractKind.Holding && x.Status == ContractStatus.Active).Select(x => x.RoomId).Distinct().CountAsync(token);
        var snapshot = new OccupancySnapshot(rooms.Length,
            rooms.Count(x => x.Status == RoomStatus.Available), rooms.Count(x => x.Status == RoomStatus.Occupied),
            rooms.Count(x => x.Status == RoomStatus.OnHold), rooms.Count(x => x.Status == RoomStatus.Unavailable),
            verifiedRooms, activeRooms);
        if (!from.HasValue)
            return new(snapshot, roomIds, [], [], [], false);

        var propertyChanges = await PropertyAuditRows().Where(x =>
                (roomIds.Contains(x.TargetId) && x.TargetType == nameof(Room) ||
                 x.TargetId == locationId && x.TargetType == "Location") && x.OccurredAt < BusinessInstant(to!.Value.AddDays(1)))
            .Select(x => new { x.TargetId, x.TargetType, x.Action, x.After, x.OccurredAt }).ToArrayAsync(token);
        var roomStatus = propertyChanges.Where(x => x.TargetType == nameof(Room)).Select(x =>
            TryStatus(x.After, out var status) ? new StatusEvidence(x.TargetId, VietnamDate(x.OccurredAt), x.OccurredAt, status) : null)
            .Where(x => x is not null).Cast<StatusEvidence>().ToArray();
        var locationStatus = propertyChanges.Where(x => x.TargetType == "Location").Select(x =>
            TryActive(x.After, out var active) ? new StatusEvidence(x.TargetId, VietnamDate(x.OccurredAt), x.OccurredAt, active ? 1 : 0) : null)
            .Where(x => x is not null).Cast<StatusEvidence>().ToArray();
        var intervals = db is Compact24DbContext nativeIntervals
            ? await (from c in nativeIntervals.Set<Native.Contract>().AsNoTracking()
                     join cr in nativeIntervals.Set<Native.ContractResident>().AsNoTracking() on c.Id equals cr.ContractId
                     where roomIds.Contains(c.RoomId) && c.ContractType != "HOLDING" && c.ActivatedAt != null &&
                           c.Status != (short)ContractStatus.Draft && c.Status != (short)ContractStatus.PendingSigning &&
                           c.Status != (short)ContractStatus.PendingActivation && c.Status != (short)ContractStatus.Cancelled
                     select new OccupancyInterval(c.RoomId,
                         cr.ResidenceFrom < c.StartDate ? c.StartDate : cr.ResidenceFrom,
                         cr.ResidenceTo != null && cr.ResidenceTo < (c.ActualEndDate ?? c.EndDate)
                             ? cr.ResidenceTo.Value : c.ActualEndDate ?? c.EndDate)).ToArrayAsync(token)
            : await (from c in db.Set<Contract>().AsNoTracking()
                               from cr in c.Residents
                               where roomIds.Contains(c.RoomId) && c.Kind != ContractKind.Holding && c.ActivatedAt != null &&
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

    private sealed record ContractHistoryRow(Guid Id, ContractKind Kind, DateTimeOffset? ActivatedAt,
        DateOnly? ActualEndDate, DateTimeOffset UpdatedAt, ContractStatus Status);
    private sealed class PropertyAuditRow
    {
        public Guid Id { get; init; }
        public Guid TargetId { get; init; }
        public string TargetType { get; init; } = "";
        public string Action { get; init; } = "";
        public string After { get; init; } = "";
        public DateTimeOffset OccurredAt { get; init; }
    }

    private IQueryable<PropertyAuditRow> PropertyAuditRows() => db is Compact24DbContext compact
        ? compact.Database.SqlQueryRaw<PropertyAuditRow>("""
            SELECT COALESCE((event_data->'state'->>'id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "Id",
                COALESCE((event_data->'state'->>'targetId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "TargetId",
                COALESCE(event_data->'state'->>'targetType','') AS "TargetType",
                COALESCE(event_data->'state'->>'action','') AS "Action",
                COALESCE(event_data->'state'->>'after','') AS "After",
                COALESCE((event_data->'state'->>'occurredAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "OccurredAt"
            FROM notifications WHERE record_kind='AUDIT' AND event_data->>'recordType'='PropertyChange'
            """)
        : db.Set<PropertyChange>().AsNoTracking().Select(x => new PropertyAuditRow
        {
            Id = x.Id, TargetId = x.TargetId, TargetType = x.TargetType, Action = x.Action,
            After = x.After, OccurredAt = x.OccurredAt
        });

    private static bool InRange(DateTimeOffset value, DateTimeOffset? from, DateTimeOffset? to) =>
        (!from.HasValue || value >= from) && (!to.HasValue || value < to);
    private static DateTimeOffset BusinessInstant(DateOnly date) =>
        new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
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
