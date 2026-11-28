using System.Linq.Expressions;
using BHome.Application.PropertyManagement;
using BHome.Domain.Common;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PostgresPropertyRepository(BHomePersistenceContext db) : IPropertyRepository
{
    private sealed record PropertyMutation(AuditableEntity Entity, int? ExpectedVersion, PropertyChange Change, AssetMetadata? Metadata = null);
    private readonly Dictionary<(Type Type, Guid Id), (AuditableEntity Entity, int? ExpectedVersion)> nativeProperties = new();
    private readonly List<PropertyMutation> propertyMutations = [];

    public async Task SaveInitialAssetMetadataAsync(Guid assetId, AssetMetadata metadata, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new PropertyException(400, "asset_metadata_requires_compact24");
        var index = propertyMutations.FindIndex(m => m.Entity is Asset && m.Entity.Id == assetId && m.ExpectedVersion is null);
        if (index >= 0)
        {
            propertyMutations[index] = propertyMutations[index] with { Metadata = metadata };
            return;
        }
        await db.SaveChangesAsync(token);
        var json = System.Text.Json.JsonSerializer.Serialize(metadata, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE assets SET purchase_info=purchase_info||{json}::jsonb WHERE id={assetId}", token);
    }
    public async Task<Guid?> LegacySystemChainIdAsync(CancellationToken token)
    {
        if (db is Compact24DbContext) return null;
        return await db.Set<Chain>().Select(x => (Guid?)x.Id).SingleOrDefaultAsync(token);
    }

    public async Task<RoomObligations> ObligationsAsync(Guid locationId, Guid? roomId, DateOnly today,
        CancellationToken token)
    {
        if (db is Compact24DbContext compact)
        {
            var nativeRooms = compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.LocationId == locationId &&
                (!roomId.HasValue || r.Id == roomId)).Select(r => r.Id);
            return await NativeObligationsAsync(compact, nativeRooms, today, token);
        }
        var rooms = db.Set<Room>().Where(r => r.LocationId == locationId &&
            (!roomId.HasValue || r.Id == roomId)).Select(r => r.Id);
        var contracts = db.Set<Contract>().Where(c => rooms.Contains(c.RoomId));
        var residents = await UnresolvedResidents(db).AnyAsync(r => r.RoomId != null && rooms.Contains(r.RoomId.Value), token);
        var occupancy = await contracts.AnyAsync(c => c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active &&
            c.Residents.Any(r => r.ResidenceFrom <= today && (r.ResidenceTo == null || r.ResidenceTo >= today)), token);
        var active = await contracts.AnyAsync(c => c.Status == ContractStatus.Active, token);
        // Status alone is not a reservation. Protect signed evidence or verified money;
        // do not infer a Holding Contract or replace activation's stricter readiness checks.
        var pending = await BindingPendingContractsAsync(db, contracts, token);
        return new(residents, occupancy, active, pending);
    }
    internal static async Task<RoomObligations> NativeObligationsAsync(Compact24DbContext context,
        IQueryable<Guid> rooms, DateOnly today, CancellationToken token, bool includeHistoricalResidents = false)
    {
        var contracts = context.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => rooms.Contains(c.RoomId));
        var members = context.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking();
        var residentQuery = includeHistoricalResidents
            ? context.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking()
            : NativeUnresolvedResidents(context);
        var residents = await residentQuery.AnyAsync(r => r.CurrentRoomId != null && rooms.Contains(r.CurrentRoomId.Value), token);
        var occupancy = await contracts.AnyAsync(c => c.ContractType != BHome.Domain.TenantContracts.ContractKind.Holding && c.Status == ContractStatus.Active &&
            members.Any(r => r.ContractId == c.Id && r.ResidenceFrom <= today && (r.ResidenceTo == null || r.ResidenceTo >= today)), token);
        var active = await contracts.AnyAsync(c => c.Status == ContractStatus.Active, token);
        var signatures = context.Set<BHome.Domain.TenantContracts.ContractSigning>().AsNoTracking();
        var allocations = context.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking();
        var pending = await contracts.AnyAsync(c => (c.Status == ContractStatus.Draft ||
            c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation) &&
            (signatures.Any(s => s.ContractId == c.Id && s.SigningStatus == SignatureStatus.Signed &&
                s.SignedAt != null && s.SignedObjectKey != null && s.SignedObjectKey != "" && s.SignedHash != null && s.SignedHash != "") ||
                allocations.Any(a => a.TargetDepositContractId == c.Id && a.Amount > 0)), token);
        return new(residents, occupancy, active, pending);
    }
    internal static Task<bool> BindingPendingContractsAsync(BHomePersistenceContext context, IQueryable<Contract> contracts, CancellationToken token)
    {
        var pending = contracts.Where(c => c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation);
        // Choose the mapped representation before constructing SQL. The archived source model
        // intentionally has no target-deposit allocation member; runtime is always Compact24.
        return context is Compact24DbContext
            ? pending.AnyAsync(c => c.Signatures.Any(s => s.Status == SignatureStatus.Signed && s.SignedAt != null &&
                s.SignedObjectKey != null && s.SignedObjectKey != "" && s.SignedHash != null && s.SignedHash != "") ||
                context.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TargetDepositContractId == c.Id && a.Amount > 0), token)
            : pending.AnyAsync(c => c.Signatures.Any(s => s.Status == SignatureStatus.Signed && s.SignedAt != null &&
                s.SignedObjectKey != null && s.SignedObjectKey != "" && s.SignedHash != null && s.SignedHash != "") ||
                context.Set<DepositVerification>().Any(d => d.ContractId == c.Id && d.Amount > 0), token);
    }
    public async Task<T?> FindAsync<T>(Guid id, CancellationToken token) where T : AuditableEntity
    {
        RequireSupportedCatalog<T>();
        if (db is Compact24DbContext compact && typeof(T) == typeof(Asset))
        {
            var row = await compact.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, token);
            if (row is null) return null;
            var asset = NativeAssetPersistence.Read(row);
            nativeProperties[(typeof(Asset), id)] = (asset, asset.Version);
            return (T)(AuditableEntity)asset;
        }
        if (db is Compact24DbContext locationContext && typeof(T) == typeof(Location))
        {
            var row = await locationContext.Set<BHome.Domain.Locations.Location>().AsNoTracking().SingleOrDefaultAsync(l => l.Id == id, token);
            if (row is null) return null;
            var location = NativeRoomLocationPersistence.Read(row);
            nativeProperties[(typeof(Location), id)] = (location, location.Version);
            return (T)(AuditableEntity)location;
        }
        if (db is Compact24DbContext roomContext && typeof(T) == typeof(Room))
        {
            var row = await roomContext.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, token);
            if (row is null) return null;
            var room = NativeRoomLocationPersistence.Read(row);
            nativeProperties[(typeof(Room), id)] = (room, room.Version);
            return (T)(AuditableEntity)room;
        }
        if (db is Compact24DbContext policyContext && typeof(T) == typeof(BillingPolicy))
        {
            var row = await policyContext.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, token);
            if (row is null) return null;
            var policy = NativePolicyPersistence.Read(row);
            nativeProperties[(typeof(BillingPolicy), id)] = (policy, policy.Version);
            return (T)(AuditableEntity)policy;
        }
        var tracked = db.ChangeTracker.Entries<T>().SingleOrDefault(x => x.Entity.Id == id);
        if (tracked is not null)
        {
            await tracked.ReloadAsync(token);
            return tracked.State == EntityState.Detached ? null : tracked.Entity;
        }
        return await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id, token);
    }
    public Task<bool> AnyAsync<T>(Expression<Func<T, bool>> predicate, CancellationToken token) where T : class =>
        db.Set<T>().AsNoTracking().AnyAsync(predicate, token);

    public Task<bool> RoomInLocationAsync(Guid roomId, Guid locationId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().AnyAsync(r => r.Id == roomId && r.LocationId == locationId, token)
            : AnyAsync<Room>(r => r.Id == roomId && r.LocationId == locationId, token);

    public Task<bool> LocationHasOperationalRoomsAsync(Guid locationId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().AnyAsync(r => r.LocationId == locationId && r.Status != RoomStatus.Unavailable, token)
            : AnyAsync<Room>(r => r.LocationId == locationId && r.Status != RoomStatus.Unavailable, token);

    public Task<bool> ActiveRoomTypeExistsAsync(Guid locationId, Guid roomTypeId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM locations l
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.operating_settings->'legacyRoomTypes','[]'::jsonb)) rt
                    WHERE (rt->>'id')::uuid={roomTypeId} AND (rt->>'locationId')::uuid={locationId}
                      AND COALESCE((rt->>'isActive')::bool,false)) AS "Value"
                """).SingleAsync(token)
            : AnyAsync<RoomType>(r => r.Id == roomTypeId && r.LocationId == locationId && r.IsActive, token);

    public Task<bool> HasOpenAssetWorkAsync(Guid assetId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? compact.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().AnyAsync(w => w.TaskType == "WORK_ORDER" &&
                w.AssetId == assetId && w.Status != "Verified" && w.Status != "Cancelled", token)
            : AnyAsync<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>(w => w.AssetId == assetId &&
                w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified &&
                w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Cancelled, token);

    private IQueryable<Contract> BindingPriceContracts()
    {
        var contracts = db.Set<Contract>().AsNoTracking().Where(c =>
            (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal || c.Kind == ContractKind.Holding));
        // The archived persistence model has no holding approval metadata.
        return db is Compact24DbContext
            ? contracts.Where(c => c.Status == ContractStatus.Active || c.Status == ContractStatus.PendingSigning ||
                c.Status == ContractStatus.PendingActivation ||
                c.Kind == ContractKind.Holding && c.Status == ContractStatus.Draft && c.ApprovedAt != null)
            : contracts.Where(c => c.Status == ContractStatus.Active || c.Status == ContractStatus.PendingSigning ||
                c.Status == ContractStatus.PendingActivation);
    }
    private static IQueryable<BHome.Domain.TenantContracts.Contract> NativeBindingPriceContracts(Compact24DbContext db) =>
        db.Set<BHome.Domain.TenantContracts.Contract>().FromSqlRaw("""
            SELECT c.* FROM contracts c LEFT JOIN LATERAL (
                SELECT h.value->'state' AS data FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='Contract' ORDER BY h.n DESC LIMIT 1
            ) s ON TRUE WHERE c.contract_type IN ('MAIN','RENEWAL','HOLDING') AND
                (c.status IN (1,2,3) OR c.contract_type='HOLDING' AND c.status=0 AND s.data->>'approvedAt' IS NOT NULL)
            """).AsNoTracking();

    private static async Task<Contract[]> ReadBindingsAsync(Compact24DbContext compact,
        IQueryable<BHome.Domain.TenantContracts.Contract> query, CancellationToken token)
    {
        var rows = await query.ToArrayAsync(token);
        var ids = rows.Select(c => c.Id).ToArray();
        var members = (await compact.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking().Where(r => ids.Contains(r.ContractId))
            .ToArrayAsync(token)).ToLookup(r => r.ContractId);
        return rows.Select(row =>
        {
            var c = NativeContractSnapshot.Read(row);
            c.Residents = members[row.Id].ToList();
            return c;
        }).ToArray();
    }

    public Task<bool> HasBindingPriceContractAsync(Guid roomId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? NativeBindingPriceContracts(compact).AnyAsync(c => c.RoomId == roomId, token)
            : BindingPriceContracts().AnyAsync(c => c.RoomId == roomId, token);
    public async Task<IReadOnlyList<Contract>> BindingPriceContractsAsync(Guid roomId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? await ReadBindingsAsync(compact, NativeBindingPriceContracts(compact).Where(c => c.RoomId == roomId), token)
            : await BindingPriceContracts().Where(c => c.RoomId == roomId).Include(c => c.Residents).ToArrayAsync(token);

    public async Task<IReadOnlyList<ScopedPriceContract>> BindingPriceContractsForLocationsAsync(Guid[] locationIds, CancellationToken token)
    {
        if (locationIds.Length == 0) return [];
        if (db is Compact24DbContext compact)
        {
            var nativeRooms = (await compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => locationIds.Contains(r.LocationId))
                .ToArrayAsync(token)).Select(NativeRoomLocationPersistence.Read).ToDictionary(r => r.Id);
            var nativeIds = nativeRooms.Keys.ToArray();
            var nativeContracts = await ReadBindingsAsync(compact,
                NativeBindingPriceContracts(compact).Where(c => nativeIds.Contains(c.RoomId)), token);
            return nativeContracts.Select(c => new ScopedPriceContract(nativeRooms[c.RoomId].LocationId,
                nativeRooms[c.RoomId].RoomTypeId, c)).ToArray();
        }
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => locationIds.Contains(r.LocationId))
            .Select(r => new { r.Id, r.LocationId, r.RoomTypeId }).ToDictionaryAsync(r => r.Id, token);
        var roomIds = rooms.Keys.ToArray();
        var contracts = await BindingPriceContracts().Where(c => roomIds.Contains(c.RoomId))
            .Include(c => c.Residents).ToArrayAsync(token);
        return contracts.Select(c => new ScopedPriceContract(rooms[c.RoomId].LocationId, rooms[c.RoomId].RoomTypeId, c)).ToArray();
    }

    public async Task<IReadOnlyDictionary<Guid, PolicyLineage>> PolicyLineagesAsync(Guid[] policyIds, CancellationToken token)
    {
        if (policyIds.Length == 0) return new Dictionary<Guid, PolicyLineage>();
        var created = db is Compact24DbContext compact
            ? await compact.Database.SqlQuery<PolicyCreationAudit>($"""
                SELECT COALESCE((event_data->'state'->>'targetId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "TargetId",
                    COALESCE(event_data->'state'->>'after','') AS "After"
                FROM notifications WHERE record_kind='AUDIT' AND event_data->>'recordType'='PropertyChange'
                    AND event_data->'state'->>'targetType'='BillingPolicy' AND event_data->'state'->>'action'='Created'
                    AND (event_data->'state'->>'targetId')::uuid=ANY({policyIds})
                """).ToArrayAsync(token)
            : await db.Set<PropertyChange>().AsNoTracking()
                .Where(c => policyIds.Contains(c.TargetId) && c.TargetType == nameof(BillingPolicy) && c.Action == "Created")
                .Select(c => new PolicyCreationAudit { TargetId = c.TargetId, After = c.After }).ToArrayAsync(token);
        var lineages = new Dictionary<Guid, PolicyLineage>();
        foreach (var change in created)
        {
            using var snapshot = System.Text.Json.JsonDocument.Parse(change.After);
            var root = snapshot.RootElement;
            if (root.ValueKind != System.Text.Json.JsonValueKind.Object ||
                !root.TryGetProperty("FamilyId", out var family) || family.ValueKind != System.Text.Json.JsonValueKind.String ||
                !family.TryGetGuid(out var familyId) || familyId == Guid.Empty ||
                !root.TryGetProperty("Edition", out var edition) || !edition.TryGetInt32(out var number) || number < 1)
                continue;
            Guid? predecessor = root.TryGetProperty("PreviousPolicyId", out var previous) &&
                previous.ValueKind == System.Text.Json.JsonValueKind.String && previous.TryGetGuid(out var previousId) ? previousId : null;
            lineages.Add(change.TargetId, new(familyId, number, predecessor));
        }
        return lineages;
    }
    private sealed class PolicyCreationAudit
    {
        public Guid TargetId { get; init; }
        public string After { get; init; } = "";
    }

    public async Task<bool> PolicyOverlapsAsync(PolicyWrite input, Guid? exceptId, CancellationToken token)
    {
        var code = PropertyRules.Normalize(input.ChargeCode);
        if (db is Compact24DbContext compact)
        {
            return await compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM billing_policies p LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                WHERE p.id IS DISTINCT FROM {exceptId} AND p.location_id={input.LocationId}
                    AND p.room_id IS NOT DISTINCT FROM {input.RoomId}
                    AND (s.data->>'roomTypeId')::uuid IS NOT DISTINCT FROM {input.RoomTypeId}
                    AND p.charge_code={code} AND (p.effective_to IS NULL OR p.effective_to>={input.EffectiveFrom})
                    AND (CAST({input.EffectiveTo} AS date) IS NULL OR p.effective_from<={input.EffectiveTo})) AS "Value"
                """).SingleAsync(token);
        }
        return await AnyAsync<BillingPolicy>(p => p.Id != exceptId && p.LocationId == input.LocationId &&
            p.RoomId == input.RoomId && p.RoomTypeId == input.RoomTypeId && p.ChargeCode == code &&
            (p.EffectiveTo == null || p.EffectiveTo >= input.EffectiveFrom) &&
            (input.EffectiveTo == null || p.EffectiveFrom <= input.EffectiveTo), token);
    }

    public Task<PagedResult<LocationDto>> ListLocationsAsync(PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token) =>
        db is Compact24DbContext compact
            ? NativePropertyPageQueries.LocationsAsync(compact, q, staffId, today, token)
            : ListAsync<Location, LocationDto>(x => (!q.IsActive.HasValue || x.IsActive == q.IsActive) &&
                (q.Search == null || x.Name.Contains(q.Search) || x.Address.Contains(q.Search)),
                x => new(x.Id, x.Name, x.Address, x.IsActive, x.Version), q, staffId, today, token);
    public Task<PagedResult<RoomDto>> ListRoomsAsync(PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token) =>
        db is Compact24DbContext compact
            ? NativePropertyPageQueries.RoomsAsync(compact, q, staffId, today, token)
            : ListAsync<Room, RoomDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
                (!q.RoomId.HasValue || x.Id == q.RoomId) &&
                (!q.RoomStatus.HasValue || x.Status == q.RoomStatus) && (q.Search == null || x.RoomNumber.Contains(q.Search)),
                x => new(x.Id, x.LocationId, x.RoomNumber, x.Floor, x.Capacity, x.Status, x.Version, x.RoomTypeId), q, staffId, today, token);
    public Task<PagedResult<AssetDto>> ListAssetsAsync(PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token) =>
        db is Compact24DbContext compact
            ? NativePropertyPageQueries.AssetsAsync(compact, q, staffId, today, token)
            : ListAsync<Asset, AssetDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
                (!q.CommonAreaOnly || x.RoomId == null && x.CommonArea != null) &&
                (!q.RoomAssetsOnly || x.RoomId != null) &&
                (!q.RoomId.HasValue || x.RoomId == q.RoomId) && (!q.AssetStatus.HasValue || x.Status == q.AssetStatus) &&
                (q.Search == null || x.Name.Contains(q.Search) || x.Code != null && x.Code.Contains(q.Search)),
                x => new(x.Id, x.LocationId, x.RoomId, x.CommonArea, x.Code, x.Name, x.Category, x.Condition, x.Status, x.Version, "Serialized", 1, null),
                q, staffId, today, token);

    public async Task<PagedResult<PolicyDto>> ListPoliciesAsync(PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token)
    {
        if (db is Compact24DbContext compact)
            return await NativePolicyQueries.ListAsync(compact, q, staffId, today, token);
        return await ListAsync<BillingPolicy, PolicyDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.RoomId.HasValue || x.RoomId == q.RoomId) &&
            (!q.ChargeCategory.HasValue || x.Category == q.ChargeCategory) &&
            (!q.EffectiveOn.HasValue || x.EffectiveFrom <= q.EffectiveOn && (x.EffectiveTo == null || x.EffectiveTo >= q.EffectiveOn)) &&
            (q.Search == null || x.ChargeCode.Contains(q.Search) || x.Name.Contains(q.Search)),
            x => new(x.Id, x.LocationId, x.RoomId, x.Category, x.ChargeCode, x.Name, x.Method,
                x.Rate, x.EffectiveFrom, x.EffectiveTo, x.Version, x.FirstUsedAt, x.RoomTypeId, null), q, staffId, today, token);
    }

    public async Task<PagedResult<TDto>> ListAsync<T, TDto>(Expression<Func<T, bool>> predicate,
        Expression<Func<T, TDto>> projection, PropertyQuery query, Guid? staffId, DateOnly today,
        CancellationToken token) where T : AuditableEntity
    {
        RequireSupportedCatalog<T>();
        var rows = db.Set<T>().AsNoTracking().Where(predicate);
        if (staffId is { } staff)
        {
            var locations = db.StaffLocationAssignments.Where(a => a.StaffUserId == staff &&
                a.StartDate <= today && today <= a.EndDate).Select(a => a.LocationId);
            rows = typeof(T) == typeof(Location) ? rows.Where(x => locations.Contains(x.Id)) :
                rows.Where(x => locations.Contains(EF.Property<Guid>(x, "LocationId")));
        }
        var count = await rows.CountAsync(token);
        var items = await rows.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Skip(checked((query.Page - 1) * query.PageSize)).Take(query.PageSize).Select(projection).ToArrayAsync(token);
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<IReadOnlyList<BillingPolicy>> ApplicablePoliciesAsync(Room room, DateOnly date, CancellationToken token)
    {
        if (db is Compact24DbContext compact)
        {
            var rows = await compact.Set<BHome.Domain.PropertyManagement.BillingPolicy>().FromSqlInterpolated($"""
                SELECT p.* FROM billing_policies p LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                WHERE p.location_id={room.LocationId} AND (p.room_id={room.Id} OR p.room_id IS NULL AND
                    ((s.data->>'roomTypeId')::uuid IS NULL OR (s.data->>'roomTypeId')::uuid={room.RoomTypeId}))
                    AND p.effective_from<={date} AND (p.effective_to IS NULL OR p.effective_to>={date})
                """).AsNoTracking().ToArrayAsync(token);
            return rows.Select(NativePolicyPersistence.Read).ToArray();
        }
        return await db.Set<BillingPolicy>().AsNoTracking().Where(x => x.LocationId == room.LocationId &&
            (x.RoomId == room.Id || x.RoomId == null &&
                (x.RoomTypeId == null || x.RoomTypeId == room.RoomTypeId)) &&
            x.EffectiveFrom <= date && (x.EffectiveTo == null || x.EffectiveTo >= date)).ToArrayAsync(token);
    }

    public async Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> operation, CancellationToken token)
    {
        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        // One lock order for configuration, deactivation, policy changes and legacy capture writes.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", token);
        try
        {
            var result = await operation();
            await db.SaveChangesAsync(token);
            if (db is Compact24DbContext compact && propertyMutations.Count != 0)
            {
                var now = DateTimeOffset.UtcNow;
                foreach (var mutation in propertyMutations)
                {
                    switch (mutation.Entity)
                    {
                        case Asset asset:
                            await NativeAssetPersistence.StageAsync(compact, asset, mutation.ExpectedVersion, null, now, token);
                            break;
                        case Location location:
                            await NativeRoomLocationPersistence.StageAsync(compact, location, mutation.ExpectedVersion, now, token);
                            break;
                        case Room room:
                            await NativeRoomLocationPersistence.StageAsync(compact, room, mutation.ExpectedVersion, now, token);
                            break;
                        case BillingPolicy policy:
                            await NativePolicyPersistence.StageAsync(compact, policy, mutation.ExpectedVersion, now, token);
                            break;
                        default:
                            throw new InvalidOperationException("Unsupported native property mutation.");
                    }
                    NativeAssetPersistence.StageAudit(compact, mutation.Change);
                    NativeAssetPersistence.StageSecurityAudit(compact, SecurityAudit(mutation.Change));
                }
                await db.SaveChangesAsync(token);
                foreach (var mutation in propertyMutations.Where(m => m.Metadata is not null))
                {
                    // PropertyService historically writes initial metadata after the
                    // creation history entry. Preserve that exact history snapshot.
                    var json = System.Text.Json.JsonSerializer.Serialize(mutation.Metadata,
                        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
                    await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE assets SET purchase_info=purchase_info||{json}::jsonb WHERE id={mutation.Entity.Id}", token);
                }
            }
            if (tx is not null) await tx.CommitAsync(token);
            return result;
        }
        catch (DbUpdateConcurrencyException) { throw new PropertyException(409, "stale_version"); }
        catch (PostgresException e) when (e.SqlState is "23505" or "23P01")
        { throw new PropertyException(409, "duplicate_or_overlapping_configuration"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23P01" })
        { throw new PropertyException(409, "duplicate_or_overlapping_configuration"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23503" or "23514" })
        { throw new PropertyException(409, "configuration_dependency_conflict"); }
        finally
        {
            nativeProperties.Clear();
            propertyMutations.Clear();
        }
    }
    internal static IQueryable<Resident> UnresolvedResidents(BHomePersistenceContext context) => context.Set<Resident>().Where(r =>
        !context.Set<Contract>().Any(c => c.RoomId == r.RoomId && c.Residents.Any(cr => cr.ResidentId == r.Id)) ||
        context.Set<Contract>().Any(c => c.RoomId == r.RoomId && c.Residents.Any(cr => cr.ResidentId == r.Id) &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation)));
    internal static IQueryable<BHome.Domain.TenantContracts.Resident> NativeUnresolvedResidents(Compact24DbContext context)
    {
        var contracts = context.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking();
        var members = context.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking();
        return context.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r =>
            !contracts.Any(c => c.RoomId == r.CurrentRoomId && members.Any(cr => cr.ContractId == c.Id && cr.ResidentId == r.Id)) ||
            contracts.Any(c => c.RoomId == r.CurrentRoomId && members.Any(cr => cr.ContractId == c.Id && cr.ResidentId == r.Id) &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Draft ||
                 c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation)));
    }
    public Task<bool> HasResidentsAsync(Guid roomId, CancellationToken token) =>
        db is Compact24DbContext compact
            ? NativeUnresolvedResidents(compact).AnyAsync(x => x.CurrentRoomId == roomId, token)
            : UnresolvedResidents(db).AnyAsync(x => x.RoomId == roomId, token);
    private void RequireSupportedCatalog<T>()
    {
        if (db is Compact24DbContext && typeof(T) == typeof(RoomType)) throw new PropertyException(404, "room_type_catalog_retired");
    }
    public void Add<T>(T entity) where T : class
    {
        RequireSupportedCatalog<T>();
        if (db is Compact24DbContext && entity is AuditableEntity property &&
            property is Asset or Location or Room or BillingPolicy)
        {
            nativeProperties.Add((property.GetType(), property.Id), (property, null));
            return;
        }
        db.Set<T>().Add(entity);
    }
    public void Audit(PropertyChange change)
    {
        if (db is Compact24DbContext && nativeProperties.Values.FirstOrDefault(p =>
            p.Entity.GetType().Name == change.TargetType && p.Entity.Id == change.TargetId) is { Entity: not null } property)
        {
            propertyMutations.Add(new(property.Entity, property.ExpectedVersion, change));
            return;
        }
        db.Set<PropertyChange>().Add(change);
        db.SecurityAudit.Add(SecurityAudit(change));
    }
    private static SecurityAuditRecord SecurityAudit(PropertyChange change) =>
        new()
        {
            UserId = change.ActorId,
            Event = "Property" + change.Action,
            TargetType = change.TargetType,
            TargetId = change.TargetId,
            Succeeded = true,
            OccurredAt = change.OccurredAt
        };
}
