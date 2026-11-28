using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class IncidentRepository(BHomePersistenceContext db,
    Microsoft.Extensions.Options.IOptions<BHome.Application.Notifications.SmsOptions>? sms = null) : IIncidentRepository
{
    private readonly NativeIncidentSession? native = db is Compact24DbContext compact ? new(compact) : null;
    private readonly NativeIncidentReads? reads = db is Compact24DbContext nativeDb ? new(nativeDb) : null;

    internal static async Task<bool> LockRoomAsync(BHomePersistenceContext db, Guid room, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
            return await compact.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={room} FOR UPDATE").SingleOrDefaultAsync(t) != Guid.Empty;
        return await db.Locked<Room>(room).AnyAsync(t);
    }

    public async Task<T> TransactionAsync<T>(Guid locationId, Guid? roomId, Guid actorId, Guid key, Func<Task<T>> work, CancellationToken t)
    {
        native?.Clear();
        // Equipment remediation shares the enclosing Location transaction and durable command key.
        if (db.Database.CurrentTransaction is not null)
        {
            if (roomId is { } nestedRoom && !await LockRoomAsync(db, nestedRoom, t)) throw IncidentException.Missing();
            var nestedResult = await work();
            await FlushAsync(t);
            native?.Clear();
            return nestedResult;
        }
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"incident-command:" + actorId + ":" + key}, 0))", t);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
            if (roomId is { } room)
            {
                // Contracts lock this same row, preventing a tenancy-end vs incident-write race.
                if (!await LockRoomAsync(db, room, t))
                    throw IncidentException.Missing();
            }
            var result = await work(); await FlushAsync(t); await tx.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw IncidentException.Conflict("stale_version"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23503" or "23514" })
        { throw IncidentException.Conflict("incident_dependency_or_duplicate_conflict"); }
        catch (PostgresException e) when (e.SqlState is "23505" or "23503" or "23514")
        { throw IncidentException.Conflict("incident_dependency_or_duplicate_conflict"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01")
        { throw IncidentException.Conflict("incident_concurrent_operation_retry"); }
        finally { native?.Clear(); }
    }

    public Task<bool> ActiveRoleAsync(Guid actor, string role, CancellationToken t) => reads is not null ? reads.ActiveRole(role).AnyAsync(id => id == actor, t) : db.Users.AsNoTracking().AnyAsync(u =>
        u.Id == actor && u.IsActive && db.UserRoles.Any(ur => ur.UserId == actor && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == role)), t);
    public Task<bool> ActiveLocationAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Location>().AnyAsync(l => l.Id == id && l.IsActive, t)
        : db.Locations.AsNoTracking().AnyAsync(l => l.Id == id && l.IsActive, t);
    public Task<FastRepairPolicy?> FastRepairPolicyAsync(CancellationToken t) => native is not null
        ? native.PolicyAsync(t) : db.Set<FastRepairPolicy>().SingleOrDefaultAsync(p => p.Id == FastRepairPolicy.GlobalId, t);
    private IQueryable<Guid> StaffAt(Guid location, DateOnly today) => reads is not null ? reads.StaffAt(location, today) :
        (
        from assignment in db.StaffLocationAssignments.AsNoTracking()
        join staff in db.Users.AsNoTracking() on assignment.StaffUserId equals staff.Id
        where assignment.LocationId == location && assignment.StartDate <= today && assignment.EndDate >= today && staff.IsActive &&
            db.Locations.Any(l => l.Id == location && l.IsActive) &&
            db.EligibleStaffIds(today).Contains(staff.Id) &&
            db.UserRoles.Any(ur => ur.UserId == staff.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))
        select staff.Id);
    public Task<bool> StaffAssignedAsync(Guid actor, Guid location, DateOnly today, CancellationToken t) => StaffAt(location, today).AnyAsync(s => s == actor, t);
    public Task<bool> StaffAvailableAsync(Guid location, DateOnly today, CancellationToken t) => StaffAt(location, today).AnyAsync(t);
    public async Task<Guid?> ResponsibleStaffAsync(Guid location, DateOnly today, CancellationToken t) =>
        await StaffAt(location, today).Select(id => (Guid?)id).SingleOrDefaultAsync(t);
    public async Task<IReadOnlyList<Guid>> RecipientsAsync(Guid location, DateOnly today, bool includeStaff, CancellationToken t)
    {
        var owners = reads is not null ? reads.ActiveRole(Roles.Owner) : db.Users.AsNoTracking().Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
            db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Owner))).Select(u => u.Id);
        return await (includeStaff ? owners.Union(StaffAt(location, today)) : owners).ToArrayAsync(t);
    }
    public Task<IncidentRoom?> RoomAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Room>().AsNoTracking().Where(r => r.Id == id).Select(r => new IncidentRoom(r.Id, r.LocationId)).SingleOrDefaultAsync(t)
        : db.Set<Room>().AsNoTracking().Where(r => r.Id == id)
        .Select(r => new IncidentRoom(r.Id, r.LocationId)).SingleOrDefaultAsync(t);
    public Task<string?> LocationNameAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Location>().AsNoTracking().Where(l => l.Id == id).Select(l => l.Name).SingleOrDefaultAsync(t)
        : db.Locations.AsNoTracking()
        .Where(l => l.Id == id).Select(l => l.Name).SingleOrDefaultAsync(t);
    public Task<string?> RoomNumberAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Room>().AsNoTracking().Where(r => r.Id == id).Select(r => r.RoomNumber).SingleOrDefaultAsync(t)
        : db.Set<Room>().AsNoTracking()
        .Where(r => r.Id == id).Select(r => r.RoomNumber).SingleOrDefaultAsync(t);
    public Task<string?> AssetNameAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Asset>().AsNoTracking().Where(a => a.Id == id).Select(a => a.Name).SingleOrDefaultAsync(t)
        : db.Set<Asset>().AsNoTracking()
        .Where(a => a.Id == id).Select(a => a.Name).SingleOrDefaultAsync(t);
    public Task<string?> StaffNameAsync(Guid id, CancellationToken t) => db.Users.AsNoTracking()
        .Where(u => u.Id == id)
        .Select(u => EF.Property<string>(u, "full_name") ?? u.UserName ?? u.Email).SingleOrDefaultAsync(t);
    public Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t) =>
        reads is not null ? reads.TenancyAsync(actor, location, room, date, t) : db.Set<Contract>().AsNoTracking().Where(c => (c.TenantUserId == actor || c.Residents.Any(cr =>
                cr.ResidenceFrom <= date && (cr.ResidenceTo == null || cr.ResidenceTo >= date) &&
                db.Set<Resident>().Any(r => r.Id == cr.ResidentId && r.TenantUserId == actor))) && c.Room.LocationId == location &&
            (room == null || c.RoomId == room) && c.Status == ContractStatus.Active && c.StartDate <= date && c.EndDate >= date &&
            (c.ActualEndDate == null || c.ActualEndDate >= date) && c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId &&
                r.ResidenceFrom <= date && (r.ResidenceTo == null || r.ResidenceTo >= date)))
        .OrderBy(c => c.RoomId).Select(c => new IncidentTenancy(c.Id, c.RoomId)).FirstOrDefaultAsync(t);
    public Task<Guid?> ContractRoomAsync(Guid contract, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.Contract>().AsNoTracking().Where(c => c.Id == contract).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(t)
        : db.Set<Contract>().AsNoTracking().Where(c => c.Id == contract)
        .Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(t);
    public Task<Asset?> AssetAsync(Guid id, CancellationToken t) => native is not null ? native.AssetAsync(id, t) :
        db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == id, t);
    public Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t) => native is not null ? native.IncidentAsync(id, t) :
        db.Set<IncidentReport>().SingleOrDefaultAsync(i => i.Id == id, t);
    public Task<MaintenanceWorkOrder?> WorkOrderAsync(Guid id, CancellationToken t) => native is not null ? native.WorkAsync(id, t) :
        db.Set<MaintenanceWorkOrder>().SingleOrDefaultAsync(w => w.Id == id, t);
    public async Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t) =>
        native is not null ? await native.WorkOrdersAsync(incident, t) :
            await db.Set<MaintenanceWorkOrder>().Where(w => w.IncidentId == incident).OrderBy(w => w.Id).ToArrayAsync(t);
    public Task<bool> OtherAssetWorkAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.OperationalTask>().AsNoTracking()
            .AnyAsync(w => w.TaskType == "WORK_ORDER" && w.AssetId == asset && w.Id != exceptWorkOrder &&
                w.Status != "Verified" && w.Status != "Cancelled", t) : db.Set<MaintenanceWorkOrder>()
        .AnyAsync(w => w.AssetId == asset && w.Id != exceptWorkOrder && w.Status != WorkOrderStatus.Verified && w.Status != WorkOrderStatus.Cancelled, t);
    public Task<bool> OtherAssetExecutionAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<BHome.Domain.Entities.OperationalTask>().AsNoTracking()
            .AnyAsync(w => w.TaskType == "WORK_ORDER" && w.AssetId == asset && w.Id != exceptWorkOrder &&
                (w.Status == "InProgress" || w.Status == "PendingVerification"), t) : db.Set<MaintenanceWorkOrder>()
        .AnyAsync(w => w.AssetId == asset && w.Id != exceptWorkOrder &&
            (w.Status == WorkOrderStatus.InProgress || w.Status == WorkOrderStatus.PendingVerification), t);
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => native is not null
        ? native.CommandAsync(actor, key, t) : db.Set<IncidentCommand>().AsNoTracking()
        .SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key, t);
    public async Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid incident, CancellationToken t) =>
        native is not null ? await native.EvidenceAsync(incident, null, t) :
            await db.Set<IncidentEvidence>().Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(t);
    public async Task<IReadOnlyList<IncidentEvidence>> WorkEvidenceAsync(Guid workOrder, CancellationToken t) =>
        native is not null ? await native.EvidenceAsync(null, workOrder, t) :
            await db.Set<IncidentEvidence>().Where(e => e.WorkOrderId == workOrder).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(t);
    public async Task<IncidentPage<IncidentActivityView>> WorkHistoryAsync(Guid workOrder, IncidentScope scope, int page, int size, CancellationToken t)
    {
        if (reads is not null) return await reads.HistoryAsync(null, workOrder, scope, page, size, t);
        var rows = db.Set<IncidentActivity>().AsNoTracking().Where(a => a.WorkOrderId == workOrder);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(a => a.OccurredAt).ThenBy(a => a.Id).Skip((page - 1) * size).Take(size)
            .Select(a => new IncidentActivityView(a.Id, a.WorkOrderId, a.Action, a.Note, a.OccurredAt, a.ActorId, scope.Owner ? a.DataJson : null)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public async Task<IReadOnlyList<EmergencyAction>> EmergencyActionsAsync(Guid incident, CancellationToken t) =>
        native is not null ? await native.EmergencyAsync(incident, t) :
            await db.Set<EmergencyAction>().Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(t);

    private IQueryable<IncidentReport> Visible(IncidentScope scope)
    {
        var rows = db.Set<IncidentReport>().AsNoTracking();
        if (scope.Owner) return rows;
        return rows.Where(r => scope.Tenant && r.ReporterRole == Roles.Tenant && r.ReporterId == scope.ActorId || scope.Staff &&
            db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) &&
            db.Locations.Any(l => l.Id == r.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a =>
                a.LocationId == r.LocationId && a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today));
    }
    private IQueryable<IncidentReport> Filter(IQueryable<IncidentReport> rows, IncidentQuery q, bool includeWorkOrderAssets = false)
    {
        if (q.LocationId is { } location) rows = rows.Where(r => r.LocationId == location);
        if (q.IncidentId is { } incident) rows = rows.Where(r => r.Id == incident);
        if (q.RoomId is { } room) rows = rows.Where(r => r.RoomId == room);
        if (q.AssetId is { } asset)
            rows = includeWorkOrderAssets
                ? rows.Where(r => r.AssetId == asset || db.Set<MaintenanceWorkOrder>().Any(w => w.IncidentId == r.Id && w.AssetId == asset))
                : rows.Where(r => r.AssetId == asset);
        if (q.Status is { } status) rows = rows.Where(r => r.Status == status);
        if (q.Severity is { } severity) rows = rows.Where(r => r.Severity == severity);
        return rows;
    }
    private IQueryable<Contract> ReportingTenancies(IncidentScope scope) => db.Set<Contract>().Where(c =>
        scope.Tenant && (c.TenantUserId == scope.ActorId || c.Residents.Any(cr => cr.ResidenceFrom <= scope.Today &&
            (cr.ResidenceTo == null || cr.ResidenceTo >= scope.Today) && db.Set<Resident>().Any(r => r.Id == cr.ResidentId && r.TenantUserId == scope.ActorId))) && c.Status == ContractStatus.Active && c.Room.Location.IsActive &&
        c.StartDate <= scope.Today && c.EndDate >= scope.Today && (c.ActualEndDate == null || c.ActualEndDate >= scope.Today) &&
        c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.ResidenceFrom <= scope.Today &&
            (r.ResidenceTo == null || r.ResidenceTo >= scope.Today)));
    private IQueryable<Guid> ReportingStaffLocations(IncidentScope scope) => db.StaffLocationAssignments.Where(a => scope.Staff &&
        db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) &&
        a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today).Select(a => a.LocationId);
    public async Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t)
    {
        if (reads is not null) return await reads.ReportingRoomsAsync(scope, query, t);
        var tenantRooms = ReportingTenancies(scope).Select(c => c.RoomId); var staffLocations = ReportingStaffLocations(scope);
        var rows = db.Set<Room>().AsNoTracking().Where(r => r.Location.IsActive && (tenantRooms.Contains(r.Id) || staffLocations.Contains(r.LocationId)));
        if (query.LocationId is { } location) rows = rows.Where(r => r.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(r => r.Id == room);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(r => r.LocationId).ThenBy(r => r.RoomNumber).ThenBy(r => r.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(r => new IncidentReportingRoom(r.Id, r.RoomNumber, r.LocationId, r.Location.Name)).ToArrayAsync(t);
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t)
    {
        if (reads is not null) return await reads.ReportingAssetsAsync(scope, query, t);
        var tenancies = ReportingTenancies(scope); var staffLocations = ReportingStaffLocations(scope);
        var rows = db.Set<Asset>().AsNoTracking().Where(a => a.Status != AssetStatus.Retired && db.Locations.Any(l => l.Id == a.LocationId && l.IsActive) &&
            (staffLocations.Contains(a.LocationId) || tenancies.Any(c => a.RoomId != null ? c.RoomId == a.RoomId : c.Room.LocationId == a.LocationId)));
        if (query.LocationId is { } location) rows = rows.Where(a => a.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(a => a.RoomId == room);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(a => a.Name).ThenBy(a => a.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(a => new IncidentReportingAsset(a.Id, a.Name, a.Category, a.Status.ToString(), a.LocationId, a.RoomId, a.CommonArea)).ToArrayAsync(t);
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<IncidentView>> ListAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        if (reads is not null) return await reads.ListAsync(scope, query, t);
        var rows = Filter(Visible(scope), query, includeWorkOrderAssets: scope.Owner); var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(r => new
            {
                Report = r,
                Available = (scope.Owner || scope.Staff) && db.StaffLocationAssignments.Any(a =>
                a.LocationId == r.LocationId && a.StartDate <= scope.Today && a.EndDate >= scope.Today &&
                db.Locations.Any(l => l.Id == r.LocationId && l.IsActive) && db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive &&
                    db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(role => role.Id == ur.RoleId && role.Name == Roles.Staff)))),
                LocationName = db.Locations.Where(l => l.Id == r.LocationId).Select(l => l.Name).FirstOrDefault(),
                RoomNumber = r.RoomId == null ? null : db.Set<Room>().Where(room => room.Id == r.RoomId).Select(room => room.RoomNumber).FirstOrDefault(),
                AssetName = r.AssetId == null ? null : db.Set<Asset>().Where(asset => asset.Id == r.AssetId).Select(asset => asset.Name).FirstOrDefault(),
                OpenWorkOrderStatus = db.Set<MaintenanceWorkOrder>()
                    .Where(work => work.IncidentId == r.Id && work.Status != WorkOrderStatus.Verified && work.Status != WorkOrderStatus.Cancelled)
                    .OrderByDescending(work => work.CreatedAt).Select(work => (WorkOrderStatus?)work.Status).FirstOrDefault(),
                AssignedStaffName = db.Set<MaintenanceWorkOrder>()
                    .Where(work => work.IncidentId == r.Id && work.Status != WorkOrderStatus.Verified && work.Status != WorkOrderStatus.Cancelled)
                    .OrderByDescending(work => work.CreatedAt)
                    .Select(work => db.Users.Where(user => user.Id == work.AssignedStaffId)
                        .Select(user => EF.Property<string>(user, "full_name") ?? user.UserName ?? user.Email).FirstOrDefault())
                    .FirstOrDefault()
            }).ToArrayAsync(t);
        return new(items.Select(x => IncidentProjection.Report(x.Report, scope.Owner || scope.Staff ? x.Available : null,
            scope.Tenant && !scope.Owner && !scope.Staff) with
        {
            // Tenant can only see their own report, so these human-readable place labels
            // do not widen the report scope and avoid exposing raw identifiers in Mobile.
            LocationName = x.LocationName,
            RoomNumber = x.RoomNumber,
            AssetName = x.AssetName,
            OpenWorkOrderStatus = scope.Owner || scope.Staff ? x.OpenWorkOrderStatus?.ToString() : null,
            AssignedStaffName = scope.Owner || scope.Staff ? x.AssignedStaffName : null
        }).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t)
    {
        if (reads is not null) return await reads.ListWorkOrdersAsync(scope, query, now, t);
        var reports = Filter(Visible(scope), query).Select(r => r.Id);
        var rows = VisibleWork(scope);
        if (query.WorkOrderId is { } workOrder) rows = rows.Where(w => w.Id == workOrder);
        if (query.IncidentId is { } incident) rows = rows.Where(w => w.IncidentId == incident);
        if (query.LocationId is { } location) rows = rows.Where(w => w.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(w => w.RoomId == room);
        if (query.AssetId is { } asset) rows = rows.Where(w => w.AssetId == asset);
        if (query.Status.HasValue || query.Severity.HasValue) rows = rows.Where(w => w.IncidentId != null && reports.Contains(w.IncidentId.Value));
        if (query.WorkOrderStatus is { } status) rows = rows.Where(w => w.Status == status);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(w => w.TargetCompletionAt).ThenBy(w => w.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(w => new
            {
                Work = w,
                LocationName = db.Locations.Where(l => l.Id == w.LocationId).Select(l => l.Name).FirstOrDefault(),
                RoomNumber = w.RoomId == null ? null : db.Set<Room>().Where(room => room.Id == w.RoomId).Select(room => room.RoomNumber).FirstOrDefault(),
                AssetName = w.AssetId == null ? null : db.Set<Asset>().Where(asset => asset.Id == w.AssetId).Select(asset => asset.Name).FirstOrDefault(),
                AssignedStaffName = db.Users.Where(u => u.Id == w.AssignedStaffId)
                    .Select(u => EF.Property<string>(u, "full_name") ?? u.UserName ?? u.Email).FirstOrDefault()
            }).ToArrayAsync(t);
        return new(items.Select(x => IncidentProjection.Work(x.Work, now, scope.Owner || x.Work.AssignedStaffId == scope.ActorId) with
        {
            LocationName = scope.Owner || scope.Staff ? x.LocationName : null,
            RoomNumber = scope.Owner || scope.Staff ? x.RoomNumber : null,
            AssetName = scope.Owner || scope.Staff ? x.AssetName : null,
            AssignedStaffName = scope.Owner || x.Work.AssignedStaffId == scope.ActorId ? x.AssignedStaffName : null
        }).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid incident, IncidentScope scope, int page, int size, CancellationToken t)
    {
        if (reads is not null) return await reads.HistoryAsync(incident, null, scope, page, size, t);
        var tenant = !scope.Owner && !scope.Staff;
        var rows = db.Set<IncidentActivity>().AsNoTracking().Where(a => a.IncidentId == incident && (!tenant || a.TenantVisible));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(a => a.OccurredAt).ThenBy(a => a.Id).Skip((page - 1) * size).Take(size)
            .Select(a => new IncidentActivityView(a.Id, tenant ? null : a.WorkOrderId, a.Action, a.Note, a.OccurredAt,
                tenant ? null : a.ActorId, scope.Owner ? a.DataJson : null)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public async Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        if (reads is not null) return await reads.MaintenanceAsync(scope, query, t);
        var reports = Filter(Visible(scope), query).Select(r => r.Id);
        var works = VisibleWork(scope).Select(w => w.Id);
        var rows = db.Set<MaintenanceHistory>().AsNoTracking().Where(h => h.IncidentId != null && reports.Contains(h.IncidentId.Value) || h.WorkOrderId != null && works.Contains(h.WorkOrderId.Value));
        if (query.WorkOrderId is { } workOrder) rows = rows.Where(h => h.WorkOrderId == workOrder);
        if (query.IncidentId is { } incident) rows = rows.Where(h => h.IncidentId == incident);
        if (query.LocationId is { } location) rows = rows.Where(h => h.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(h => h.RoomId == room);
        if (query.AssetId is { } asset) rows = rows.Where(h => h.AssetId == asset);
        // Cost-bearing maintenance history is Owner-only. Staff uses its Work Order progress timeline.
        if (!scope.Owner) rows = rows.Where(h => h.WorkOrderId != null && db.Set<MaintenanceWorkOrder>()
            .Any(w => w.Id == h.WorkOrderId && w.AssignedStaffId == scope.ActorId));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(h => h.VerifiedAt).ThenBy(h => h.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(h => new MaintenanceHistoryView(h.Id, h.ActivityId,
                db.Set<IncidentActivity>().Where(a => a.Id == h.ActivityId).Select(a => a.Action).First(),
                h.IncidentId, h.WorkOrderId, h.RoomId, h.AssetId, h.ConditionBefore,
                h.ConditionAfter, h.StatusBefore, h.StatusAfter, h.ActualCost, h.VerifiedById, h.VerifiedAt)).ToArrayAsync(t);
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t) => reads is not null ? await reads.ExpensesAsync(incident, t) : await db.Set<MaintenanceExpense>().AsNoTracking()
        .Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
        .Select(e => new ExpenseView(e.Id, e.IncidentId, e.WorkOrderId, e.EmergencyActionId, e.Category, e.Amount, e.ExpenseDate)).ToArrayAsync(t);
    public async Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t)
    {
        if (reads is not null) return await reads.NotificationsAsync(scope, page, size, t);
        var reports = Visible(scope).Select(r => r.Id);
        var works = VisibleWork(scope).Select(w => w.Id);
        var rows = db.Set<IncidentNotification>().AsNoTracking().Where(n => n.RecipientId == scope.ActorId &&
            (n.IncidentId != null && reports.Contains(n.IncidentId.Value) || n.WorkOrderId != null && works.Contains(n.WorkOrderId.Value)));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id).Skip((page - 1) * size).Take(size)
            .Select(n => new IncidentNotificationView(n.Id, n.IncidentId, n.Event, n.HighPriority, n.CreatedAt, n.ReadAt,
                n.DeliveryState, scope.Tenant && !scope.Owner && !scope.Staff ? null : n.WorkOrderId)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t) =>
        native is not null ? native.NotificationAsync(id, actor, t) :
            db.Set<IncidentNotification>().SingleOrDefaultAsync(n => n.Id == id && n.RecipientId == actor, t);
    public Task FlushAsync(CancellationToken t) => native is not null ? native.FlushAsync(t) : db.SaveChangesAsync(t);
    private IQueryable<MaintenanceWorkOrder> VisibleWork(IncidentScope scope) => db.Set<MaintenanceWorkOrder>().AsNoTracking().Where(w =>
        scope.Owner || scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) && db.Locations.Any(l => l.Id == w.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a =>
            a.LocationId == w.LocationId && a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today));
    public void Add(object entity)
    {
        // Immediate in-app publication must retain the configured external delivery channels.
        if (entity is BHome.Domain.Notifications.UserNotification notice && sms?.Value.Enabled == true &&
            BHome.Infrastructure.Modules.Notifications.SmsNotificationPolicy.Template(notice.EventType, notice.AudienceRole) is { } template &&
            sms.Value.EnabledTemplates.Contains(template))
            notice.Channels = notice.Channels.Append("SMS").Distinct().ToArray();
        if (native is null) db.Add(entity);
        else if (!native.Add(entity)) throw new InvalidOperationException("Unsupported native incident entity.");
    }
    public void Audit(Guid actor, string action, Guid activityId, DateTimeOffset now)
    {
        if (native is not null) native.Audit(actor, action, activityId, now);
        else db.SecurityAudit.Add(new SecurityAuditRecord
        { UserId = actor, Event = action, TargetType = "IncidentActivity", TargetId = activityId, OccurredAt = now, Succeeded = true });
    }
}
