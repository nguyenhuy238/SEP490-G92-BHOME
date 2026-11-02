using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class IncidentRepository(BHomeDbContext db) : IIncidentRepository
{
    public async Task<T> TransactionAsync<T>(Guid locationId, Guid? roomId, Guid actorId, Guid key, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"incident-command:" + actorId + ":" + key}, 0))", t);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
            if (roomId is { } room)
            {
                // Contracts lock this same row, preventing a tenancy-end vs incident-write race.
                if (!await db.Set<Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\" = {room} FOR UPDATE").AnyAsync(t))
                    throw IncidentException.Missing();
            }
            var result = await work(); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw IncidentException.Conflict("stale_version"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23503" or "23514" })
        { throw IncidentException.Conflict("incident_dependency_or_duplicate_conflict"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01")
        { throw IncidentException.Conflict("incident_concurrent_operation_retry"); }
    }

    public Task<bool> ActiveRoleAsync(Guid actor, string role, CancellationToken t) => db.Users.AsNoTracking().AnyAsync(u =>
        u.Id == actor && u.IsActive && db.UserRoles.Any(ur => ur.UserId == actor && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == role)), t);
    public Task<bool> ActiveLocationAsync(Guid id, CancellationToken t) => db.Locations.AsNoTracking().AnyAsync(l => l.Id == id && l.IsActive, t);
    private IQueryable<Guid> StaffAt(Guid location, DateOnly today) =>
        from assignment in db.StaffLocationAssignments.AsNoTracking()
        join staff in db.Users.AsNoTracking() on assignment.StaffUserId equals staff.Id
        where assignment.LocationId == location && assignment.StartDate <= today && assignment.EndDate >= today && staff.IsActive &&
            db.Locations.Any(l => l.Id == location && l.IsActive) &&
            db.UserRoles.Any(ur => ur.UserId == staff.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))
        select staff.Id;
    public Task<bool> StaffAssignedAsync(Guid actor, Guid location, DateOnly today, CancellationToken t) => StaffAt(location, today).AnyAsync(s => s == actor, t);
    public Task<bool> StaffAvailableAsync(Guid location, DateOnly today, CancellationToken t) => StaffAt(location, today).AnyAsync(t);
    public async Task<IReadOnlyList<Guid>> RecipientsAsync(Guid location, DateOnly today, bool includeStaff, CancellationToken t)
    {
        var owners = db.Users.AsNoTracking().Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
            db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Owner))).Select(u => u.Id);
        return await (includeStaff ? owners.Union(StaffAt(location, today)) : owners).ToArrayAsync(t);
    }
    public Task<IncidentRoom?> RoomAsync(Guid id, CancellationToken t) => db.Set<Room>().AsNoTracking().Where(r => r.Id == id)
        .Select(r => new IncidentRoom(r.Id, r.LocationId)).SingleOrDefaultAsync(t);
    public Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t) =>
        db.Set<Contract>().AsNoTracking().Where(c => c.TenantUserId == actor && c.Room.LocationId == location &&
            (room == null || c.RoomId == room) && c.Status == ContractStatus.Active && c.StartDate <= date && c.EndDate >= date &&
            (c.ActualEndDate == null || c.ActualEndDate >= date) && c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId &&
                r.ResidenceFrom <= date && (r.ResidenceTo == null || r.ResidenceTo >= date)))
        .OrderBy(c => c.RoomId).Select(c => new IncidentTenancy(c.Id, c.RoomId)).FirstOrDefaultAsync(t);
    public Task<Guid?> ContractRoomAsync(Guid contract, CancellationToken t) => db.Set<Contract>().AsNoTracking().Where(c => c.Id == contract)
        .Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(t);
    public Task<Asset?> AssetAsync(Guid id, CancellationToken t) => db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == id, t);
    public Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t) => db.Set<IncidentReport>().SingleOrDefaultAsync(i => i.Id == id, t);
    public Task<MaintenanceWorkOrder?> WorkOrderAsync(Guid id, CancellationToken t) => db.Set<MaintenanceWorkOrder>().SingleOrDefaultAsync(w => w.Id == id, t);
    public async Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t) =>
        await db.Set<MaintenanceWorkOrder>().Where(w => w.IncidentId == incident).OrderBy(w => w.Id).ToArrayAsync(t);
    public Task<bool> OtherAssetWorkAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => db.Set<MaintenanceWorkOrder>()
        .AnyAsync(w => w.AssetId == asset && w.Id != exceptWorkOrder && w.Status != WorkOrderStatus.Verified && w.Status != WorkOrderStatus.Cancelled, t);
    public Task<bool> OtherAssetExecutionAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => db.Set<MaintenanceWorkOrder>()
        .AnyAsync(w => w.AssetId == asset && w.Id != exceptWorkOrder &&
            (w.Status == WorkOrderStatus.InProgress || w.Status == WorkOrderStatus.PendingVerification), t);
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => db.Set<IncidentCommand>().AsNoTracking()
        .SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key, t);
    public async Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid incident, CancellationToken t) =>
        await db.Set<IncidentEvidence>().Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(t);
    public async Task<IReadOnlyList<EmergencyAction>> EmergencyActionsAsync(Guid incident, CancellationToken t) =>
        await db.Set<EmergencyAction>().Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArrayAsync(t);

    private IQueryable<IncidentReport> Visible(IncidentScope scope)
    {
        var rows = db.Set<IncidentReport>().AsNoTracking();
        if (scope.Owner) return rows;
        return rows.Where(r => scope.Tenant && r.ReporterRole == Roles.Tenant && r.ReporterId == scope.ActorId || scope.Staff &&
            db.Locations.Any(l => l.Id == r.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a =>
                a.LocationId == r.LocationId && a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today));
    }
    private static IQueryable<IncidentReport> Filter(IQueryable<IncidentReport> rows, IncidentQuery q)
    {
        if (q.LocationId is { } location) rows = rows.Where(r => r.LocationId == location);
        if (q.IncidentId is { } incident) rows = rows.Where(r => r.Id == incident);
        if (q.RoomId is { } room) rows = rows.Where(r => r.RoomId == room);
        if (q.AssetId is { } asset) rows = rows.Where(r => r.AssetId == asset);
        if (q.Status is { } status) rows = rows.Where(r => r.Status == status);
        if (q.Severity is { } severity) rows = rows.Where(r => r.Severity == severity);
        return rows;
    }
    private IQueryable<Contract> ReportingTenancies(IncidentScope scope) => db.Set<Contract>().Where(c =>
        scope.Tenant && c.TenantUserId == scope.ActorId && c.Status == ContractStatus.Active && c.Room.Location.IsActive &&
        c.StartDate <= scope.Today && c.EndDate >= scope.Today && (c.ActualEndDate == null || c.ActualEndDate >= scope.Today) &&
        c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.ResidenceFrom <= scope.Today &&
            (r.ResidenceTo == null || r.ResidenceTo >= scope.Today)));
    private IQueryable<Guid> ReportingStaffLocations(IncidentScope scope) => db.StaffLocationAssignments.Where(a => scope.Staff &&
        a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today).Select(a => a.LocationId);
    public async Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t)
    {
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
        var tenancies = ReportingTenancies(scope); var staffLocations = ReportingStaffLocations(scope);
        var rows = db.Set<Asset>().AsNoTracking().Where(a => db.Locations.Any(l => l.Id == a.LocationId && l.IsActive) &&
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
        var rows = Filter(Visible(scope), query); var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(r => new
            {
                Report = r,
                Available = (scope.Owner || scope.Staff) && db.StaffLocationAssignments.Any(a =>
                a.LocationId == r.LocationId && a.StartDate <= scope.Today && a.EndDate >= scope.Today &&
                db.Locations.Any(l => l.Id == r.LocationId && l.IsActive) && db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive &&
                    db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(role => role.Id == ur.RoleId && role.Name == Roles.Staff))))
            }).ToArrayAsync(t);
        return new(items.Select(x => IncidentProjection.Report(x.Report, scope.Owner || scope.Staff ? x.Available : null)).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t)
    {
        var reports = Filter(Visible(scope), query).Select(r => r.Id);
        var rows = db.Set<MaintenanceWorkOrder>().AsNoTracking().Where(w => reports.Contains(w.IncidentId));
        if (query.WorkOrderStatus is { } status) rows = rows.Where(w => w.Status == status);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(w => w.TargetCompletionAt).ThenBy(w => w.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        return new(items.Select(w => IncidentProjection.Work(w, now, scope.Owner || w.AssignedStaffId == scope.ActorId)).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid incident, IncidentScope scope, int page, int size, CancellationToken t)
    {
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
        var reports = Filter(Visible(scope), query).Select(r => r.Id);
        var rows = db.Set<MaintenanceHistory>().AsNoTracking().Where(h => reports.Contains(h.IncidentId));
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
    public async Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t) => await db.Set<MaintenanceExpense>().AsNoTracking()
        .Where(e => e.IncidentId == incident).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
        .Select(e => new ExpenseView(e.Id, e.IncidentId, e.WorkOrderId, e.EmergencyActionId, e.Category, e.Amount, e.ExpenseDate)).ToArrayAsync(t);
    public async Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t)
    {
        var reports = Visible(scope).Select(r => r.Id);
        var rows = db.Set<IncidentNotification>().AsNoTracking().Where(n => n.RecipientId == scope.ActorId && reports.Contains(n.IncidentId));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id).Skip((page - 1) * size).Take(size)
            .Select(n => new IncidentNotificationView(n.Id, n.IncidentId, n.Event, n.HighPriority, n.CreatedAt, n.ReadAt, n.DeliveryState)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t) =>
        db.Set<IncidentNotification>().SingleOrDefaultAsync(n => n.Id == id && n.RecipientId == actor, t);
    public Task FlushAsync(CancellationToken t) => db.SaveChangesAsync(t);
    public void Add(object entity) => db.Add(entity);
    public void Audit(Guid actor, string action, Guid activityId, DateTimeOffset now) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetType = "IncidentActivity", TargetId = activityId, OccurredAt = now, Succeeded = true });
}
