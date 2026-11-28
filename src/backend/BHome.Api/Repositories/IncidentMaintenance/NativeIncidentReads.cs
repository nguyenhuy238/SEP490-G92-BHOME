using System.Text.Json;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class NativeIncidentReads(Compact24DbContext db)
{
    private IQueryable<BHome.Domain.Locations.Location> Locations => db.Set<BHome.Domain.Locations.Location>().AsNoTracking();
    private IQueryable<BHome.Domain.PropertyManagement.Room> Rooms => db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking();
    private IQueryable<BHome.Domain.PropertyManagement.Asset> Assets => db.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking();
    private IQueryable<BHome.Domain.Billing.OperationalTask> Work => db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(w => w.TaskType == "WORK_ORDER");
    internal IQueryable<Guid> ActiveRole(string role) => db.Database.SqlQuery<Guid>($"""
        SELECT id AS "Value" FROM users WHERE is_active AND {role}=ANY(roles)
        """);
    internal IQueryable<Guid> StaffAt(Guid location, DateOnly date) =>
        NativeOperationalTaskPersistence.Assignments(db, date).Where(a => a.IsActive && a.LocationId == location).Select(a => a.StaffUserId);
    private IQueryable<Guid> StaffLocations(IncidentScope scope) =>
        NativeOperationalTaskPersistence.Assignments(db, scope.Today)
            .Where(a => scope.Staff && a.IsActive && a.StaffUserId == scope.ActorId).Select(a => a.LocationId);
    private IQueryable<BHome.Domain.TenantContracts.Contract> Tenancies(Guid actor, DateOnly date) =>
        db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.Status == ContractStatus.Active &&
            c.StartDate <= date && c.EndDate >= date && (c.ActualEndDate == null || c.ActualEndDate >= date) &&
            (c.TenantUserId == actor || db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr =>
                cr.ContractId == c.Id && cr.ResidenceFrom <= date && (cr.ResidenceTo == null || cr.ResidenceTo >= date) &&
                db.Set<BHome.Domain.TenantContracts.Resident>().Any(r => r.Id == cr.ResidentId && r.UserId == actor))) &&
            db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr => cr.ContractId == c.Id && cr.ResidentId == c.RepresentativeResidentId &&
                cr.ResidenceFrom <= date && (cr.ResidenceTo == null || cr.ResidenceTo >= date)));
    internal Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t) =>
        (from c in Tenancies(actor, date)
         join r in Rooms on c.RoomId equals r.Id
         where r.LocationId == location && (room == null || r.Id == room)
         orderby c.RoomId
         select new IncidentTenancy(c.Id, c.RoomId)).FirstOrDefaultAsync(t);
    private IQueryable<BHome.Domain.TenantContracts.Contract> ReportingTenancies(IncidentScope scope) =>
        Tenancies(scope.ActorId, scope.Today).Where(c => scope.Tenant &&
            Rooms.Any(r => r.Id == c.RoomId && Locations.Any(l => l.Id == r.LocationId && l.IsActive)));
    internal async Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t)
    {
        var tenantRooms = ReportingTenancies(scope).Select(c => c.RoomId);
        var staffLocations = StaffLocations(scope);
        var rows = from r in Rooms
                   join l in Locations on r.LocationId equals l.Id
                   where l.IsActive && (tenantRooms.Contains(r.Id) || staffLocations.Contains(r.LocationId))
                   select new { Room = r, LocationName = l.Name };
        if (query.LocationId is { } location) rows = rows.Where(r => r.Room.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(r => r.Room.Id == room);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(r => r.Room.LocationId).ThenBy(r => r.Room.RoomNumber).ThenBy(r => r.Room.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(r => new IncidentReportingRoom(r.Room.Id, r.Room.RoomNumber, r.Room.LocationId, r.LocationName)).ToArrayAsync(t);
        return new(items, query.Page, query.PageSize, count);
    }
    internal async Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t)
    {
        var tenancies = ReportingTenancies(scope); var staffLocations = StaffLocations(scope);
        var rows = Assets.Where(a => a.Status != AssetStatus.Retired && Locations.Any(l => l.Id == a.LocationId && l.IsActive) &&
            (staffLocations.Contains(a.LocationId) || tenancies.Any(c => a.RoomId != null ? c.RoomId == a.RoomId :
                Rooms.Any(r => r.Id == c.RoomId && r.LocationId == a.LocationId))));
        if (query.LocationId is { } location) rows = rows.Where(a => a.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(a => a.RoomId == room);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(a => a.Name).ThenBy(a => a.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        return new(items.Select(a => new IncidentReportingAsset(a.Id, a.Name, a.Category, ((AssetStatus)a.Status).ToString(),
            a.LocationId, a.RoomId, a.CommonArea)).ToArray(), query.Page, query.PageSize, count);
    }
    private IQueryable<IncidentReport> Reports(IncidentScope scope)
    {
        var rows = db.Set<IncidentReport>().AsNoTracking();
        if (scope.Owner) return rows;
        var staffLocations = StaffLocations(scope);
        var tenantReports = db.Database.SqlQuery<Guid>($"""
            SELECT r.id AS "Value" FROM incident_reports r
            CROSS JOIN LATERAL (SELECT h->'state' AS state FROM jsonb_array_elements(r.history) WITH ORDINALITY a(h,n)
                WHERE h->>'recordType'='IncidentReport' ORDER BY n DESC LIMIT 1) s
            WHERE r.reporter_user_id={scope.ActorId} AND s.state->>'reporterRole'='Tenant'
            """);
        return rows.Where(r => scope.Tenant && tenantReports.Contains(r.Id) || staffLocations.Contains(r.LocationId));
    }
    private IQueryable<BHome.Domain.Billing.OperationalTask> VisibleWork(IncidentScope scope)
    {
        var locations = StaffLocations(scope);
        return scope.Owner ? Work : Work.Where(w => w.LocationId != null && locations.Contains(w.LocationId.Value));
    }
    private IQueryable<IncidentReport> Filter(IQueryable<IncidentReport> rows, IncidentQuery q, bool includeWorkOrderAssets = false)
    {
        if (q.LocationId is { } location) rows = rows.Where(r => r.LocationId == location);
        if (q.IncidentId is { } incident) rows = rows.Where(r => r.Id == incident);
        if (q.RoomId is { } room) rows = rows.Where(r => r.RoomId == room);
        if (q.AssetId is { } asset) rows = includeWorkOrderAssets
            ? rows.Where(r => r.AssetId == asset || Work.Any(w => w.IncidentReportId == r.Id && w.AssetId == asset))
            : rows.Where(r => r.AssetId == asset);
        if (q.Status is { } status) rows = rows.Where(r => r.Status == status);
        if (q.Severity is { } severity) rows = rows.Where(r => r.Severity == severity);
        return rows;
    }
    internal async Task<IncidentPage<IncidentView>> ListAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        var rows = Filter(Reports(scope), query, scope.Owner);
        var count = await rows.CountAsync(t);
        var available = db.Database.SqlQuery<Guid>($"""
            SELECT DISTINCT l.id AS "Value" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            JOIN users u ON u.id=(a->>'staffUserId')::uuid
            WHERE l.is_active AND u.is_active AND 'Staff'=ANY(u.roles)
                AND (a->>'startDate')::date<={scope.Today} AND (a->>'endDate')::date>={scope.Today}
            """);
        var items = await rows.OrderByDescending(r => r.ReportedAt).ThenBy(r => r.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(r => new
            {
                Report = r,
                Available = available.Contains(r.LocationId),
                LocationName = Locations.Where(l => l.Id == r.LocationId).Select(l => l.Name).FirstOrDefault(),
                RoomNumber = Rooms.Where(room => room.Id == r.RoomId).Select(room => room.RoomNumber).FirstOrDefault(),
                AssetName = Assets.Where(asset => asset.Id == r.AssetId).Select(asset => asset.Name).FirstOrDefault()
            }).ToArrayAsync(t);
        var ids = items.Select(x => x.Report.Id).ToArray();
        var open = (await Work.Where(w => w.IncidentReportId != null && ids.Contains(w.IncidentReportId.Value) &&
            w.Status != "Verified" && w.Status != "Cancelled").ToArrayAsync(t)).Select(NativeIncidentSession.Read)
            .GroupBy(w => w.IncidentId!.Value).ToDictionary(g => g.Key, g => g.OrderByDescending(w => w.CreatedAt).ThenBy(w => w.Id).First());
        var staffIds = open.Values.Select(w => w.AssignedStaffId).Distinct().ToArray();
        var names = await db.Users.AsNoTracking().Where(u => staffIds.Contains(u.Id))
            .Select(u => new { u.Id, Name = EF.Property<string>(u, "full_name") ?? u.UserName ?? u.Email }).ToDictionaryAsync(u => u.Id, u => u.Name, t);
        return new(items.Select(x => IncidentProjection.Report(NativeIncidentSession.Read(x.Report),
            scope.Owner || scope.Staff ? x.Available : null, scope.Tenant && !scope.Owner && !scope.Staff) with
        {
            LocationName = x.LocationName,
            RoomNumber = x.RoomNumber,
            AssetName = x.AssetName,
            OpenWorkOrderStatus = scope.Owner || scope.Staff ? open.GetValueOrDefault(x.Report.Id)?.Status.ToString() : null,
            AssignedStaffName = (scope.Owner || scope.Staff) && open.TryGetValue(x.Report.Id, out var w) ? names.GetValueOrDefault(w.AssignedStaffId) : null
        }).ToArray(), query.Page, query.PageSize, count);
    }
    internal async Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t)
    {
        var reports = Filter(Reports(scope), query).Select(r => r.Id);
        var rows = VisibleWork(scope);
        if (query.WorkOrderId is { } workOrder) rows = rows.Where(w => w.Id == workOrder);
        if (query.IncidentId is { } incident) rows = rows.Where(w => w.IncidentReportId == incident);
        if (query.LocationId is { } location) rows = rows.Where(w => w.LocationId == location);
        if (query.RoomId is { } room) rows = rows.Where(w => w.RoomId == room);
        if (query.AssetId is { } asset) rows = rows.Where(w => w.AssetId == asset);
        if (query.Status.HasValue || query.Severity.HasValue) rows = rows.Where(w => w.IncidentReportId != null && reports.Contains(w.IncidentReportId.Value));
        if (query.WorkOrderStatus is { } status) { var key = status.ToString(); rows = rows.Where(w => w.Status == key); }
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(w => w.DueAt).ThenBy(w => w.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(w => new
            {
                Work = w,
                LocationName = Locations.Where(l => l.Id == w.LocationId).Select(l => l.Name).FirstOrDefault(),
                RoomNumber = Rooms.Where(room => room.Id == w.RoomId).Select(room => room.RoomNumber).FirstOrDefault(),
                AssetName = Assets.Where(asset => asset.Id == w.AssetId).Select(asset => asset.Name).FirstOrDefault(),
                AssignedStaffName = db.Users.Where(u => u.Id == w.AssignedUserId)
                    .Select(u => EF.Property<string>(u, "full_name") ?? u.UserName ?? u.Email).FirstOrDefault()
            }).ToArrayAsync(t);
        return new(items.Select(x => IncidentProjection.Work(NativeIncidentSession.Read(x.Work), now, scope.Owner || x.Work.AssignedUserId == scope.ActorId) with
        {
            LocationName = scope.Owner || scope.Staff ? x.LocationName : null,
            RoomNumber = scope.Owner || scope.Staff ? x.RoomNumber : null,
            AssetName = scope.Owner || scope.Staff ? x.AssetName : null,
            AssignedStaffName = scope.Owner || x.Work.AssignedUserId == scope.ActorId ? x.AssignedStaffName : null
        }).ToArray(), query.Page, query.PageSize, count);
    }
    private async Task<T[]> HistoryRows<T>(string kind, Guid[] reports, Guid[] works, CancellationToken t) =>
        (await db.Database.SqlQuery<string>($"""
            SELECT (s.h->'state')::text AS "Value" FROM (
                SELECT history FROM incident_reports WHERE id=ANY({reports})
                UNION ALL SELECT history FROM operational_tasks WHERE task_type='WORK_ORDER' AND id=ANY({works})
            ) parents
            CROSS JOIN LATERAL (SELECT DISTINCT ON (h->>'recordKey') h FROM jsonb_array_elements(parents.history)
                WITH ORDINALITY a(h,n) WHERE h->>'recordType'={kind} ORDER BY h->>'recordKey',n DESC) s
            WHERE COALESCE(s.h->>'deleted','false')<>'true'
            """).ToArrayAsync(t)).Select(x => JsonSerializer.Deserialize<T>(x, IncidentSnapshots.Json)!).ToArray();
    internal async Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid? incident, Guid? work, IncidentScope scope, int page, int size, CancellationToken t)
    {
        var workIds = work is { } id ? new[] { id } : await Work.Where(w => w.IncidentReportId == incident).Select(w => w.Id).ToArrayAsync(t);
        var reportIds = incident is { } r ? new[] { r } :
            await Work.Where(w => w.Id == work && w.IncidentReportId != null).Select(w => w.IncidentReportId!.Value).ToArrayAsync(t);
        var tenant = work is null && !scope.Owner && !scope.Staff;
        var rows = (await HistoryRows<IncidentSnapshots.IncidentActivityState>("IncidentActivity", reportIds, workIds, t))
            .Where(a => (work is null ? a.IncidentId == incident : a.WorkOrderId == work) && (!tenant || a.TenantVisible))
            .OrderByDescending(a => a.OccurredAt).ThenBy(a => a.Id).ToArray();
        return new(rows.Skip((page - 1) * size).Take(size).Select(a => new IncidentActivityView(a.Id, tenant ? null : a.WorkOrderId,
            a.Action, a.Note, a.OccurredAt, tenant ? null : a.ActorId, scope.Owner ? a.DataJson : null)).ToArray(), page, size, rows.Length);
    }
    internal async Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        var reports = await Filter(Reports(scope), query).Select(r => r.Id).ToArrayAsync(t);
        var visibleWorks = await VisibleWork(scope).Select(w => new { w.Id, w.AssignedUserId, w.IncidentReportId }).ToArrayAsync(t);
        var works = visibleWorks.Select(w => w.Id).ToArray();
        var parentReports = reports.Concat(visibleWorks.Select(w => w.IncidentReportId).OfType<Guid>()).Distinct().ToArray();
        var allWorks = await Work.Where(w => w.IncidentReportId != null && reports.Contains(w.IncidentReportId.Value) || works.Contains(w.Id))
            .Select(w => new { w.Id, w.AssignedUserId }).ToArrayAsync(t);
        var ownWorks = allWorks.Where(w => w.AssignedUserId == scope.ActorId).Select(w => w.Id).ToHashSet();
        var rows = (await HistoryRows<IncidentSnapshots.MaintenanceHistoryState>("MaintenanceHistory", parentReports, allWorks.Select(w => w.Id).ToArray(), t))
            .Where(h => (h.IncidentId != null && reports.Contains(h.IncidentId.Value) || h.WorkOrderId != null && works.Contains(h.WorkOrderId.Value)) &&
                (query.WorkOrderId == null || h.WorkOrderId == query.WorkOrderId) && (query.IncidentId == null || h.IncidentId == query.IncidentId) &&
                (query.LocationId == null || h.LocationId == query.LocationId) && (query.RoomId == null || h.RoomId == query.RoomId) &&
                (query.AssetId == null || h.AssetId == query.AssetId) && (scope.Owner || h.WorkOrderId != null && ownWorks.Contains(h.WorkOrderId.Value)))
            .OrderByDescending(h => h.VerifiedAt).ThenBy(h => h.Id).ToArray();
        var pageRows = rows.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArray();
        var actions = (await HistoryRows<IncidentSnapshots.IncidentActivityState>("IncidentActivity",
            pageRows.Select(h => h.IncidentId).OfType<Guid>().Distinct().ToArray(),
            pageRows.Select(h => h.WorkOrderId).OfType<Guid>().Distinct().ToArray(), t)).ToDictionary(a => a.Id, a => a.Action);
        return new(pageRows.Select(h => new MaintenanceHistoryView(h.Id, h.ActivityId, actions[h.ActivityId], h.IncidentId, h.WorkOrderId,
            h.RoomId, h.AssetId, h.ConditionBefore, h.ConditionAfter, h.StatusBefore, h.StatusAfter, h.ActualCost, h.VerifiedById, h.VerifiedAt)).ToArray(),
            query.Page, query.PageSize, rows.Length);
    }
    internal async Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t)
    {
        var rows = await db.Set<Native.Expense>().AsNoTracking().Where(e => e.IncidentReportId == incident && e.ExpenseType == "OPERATING").ToArrayAsync(t);
        return rows.Select(e => IncidentSnapshots.Latest(e.History, "MaintenanceExpense")).Where(s => s.ValueKind == JsonValueKind.Object)
            .Select(s => s.Deserialize<IncidentSnapshots.MaintenanceExpenseState>(IncidentSnapshots.Json)!)
            .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
            .Select(e => new ExpenseView(e.Id, e.IncidentId, e.WorkOrderId, e.EmergencyActionId, e.Category, e.Amount, e.ExpenseDate)).ToArray();
    }
    internal async Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t)
    {
        var reports = await Reports(scope).Select(r => r.Id).ToArrayAsync(t);
        var works = await VisibleWork(scope).Select(w => w.Id).ToArrayAsync(t);
        var rows = db.Set<Native.Notification>().FromSqlInterpolated($"""
            SELECT * FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='IncidentNotification'
              AND event_data->'state'->>'recipientId'={scope.ActorId.ToString()}
              AND ((event_data->'state'->>'incidentId')::uuid=ANY({reports}) OR
                   (event_data->'state'->>'workOrderId')::uuid=ANY({works}))
            """).AsNoTracking();
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.EventAt).ThenBy(n => n.Id).Skip((page - 1) * size).Take(size).ToArrayAsync(t);
        var notices = items.Select(row =>
        {
            var state = IncidentSnapshots.Latest(row.DeliveryHistory, "IncidentNotification");
            if (state.ValueKind != JsonValueKind.Object) state = row.EventData.GetProperty("state");
            var notice = state.Deserialize<IncidentSnapshots.IncidentNotificationState>(IncidentSnapshots.Json)!.ToDomain();
            notice.ReadAt = row.ReadAt;
            return notice;
        });
        return new(notices
            .Select(n => new IncidentNotificationView(n.Id, n.IncidentId, n.Event, n.HighPriority, n.CreatedAt, n.ReadAt,
                n.DeliveryState, scope.Tenant && !scope.Owner && !scope.Staff ? null : n.WorkOrderId)).ToArray(), page, size, count);
    }
}
