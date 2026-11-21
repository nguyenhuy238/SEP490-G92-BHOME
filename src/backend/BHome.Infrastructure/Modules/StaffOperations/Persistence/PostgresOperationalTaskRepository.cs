using BHome.Application.StaffOperations;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.StaffOperations.Persistence;

internal sealed class PostgresOperationalTaskRepository(BHomePersistenceContext db,
    CompactNotificationWriter? inbox = null, ISetupWorkspaceStore? workspace = null) : IOperationalTaskRepository
{
    public async Task<T> TransactionAsync<T>(Guid locationId, Guid actorId, Guid commandKey, Func<Task<T>> operation, CancellationToken t)
    {
        // An enclosing inspection workflow owns the Location lock and commits both records.
        if (db.Database.CurrentTransaction is not null)
        {
            var nestedResult = await operation();
            await db.SaveChangesAsync(t);
            return nestedResult;
        }
        await using var tx = await db.Database.BeginTransactionAsync(t);
        // Serialize retries across targets, then share Location lock ordering with configuration/assignments.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"task-command:" + actorId + ":" + commandKey}, 0))", t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
        try
        {
            var result = await operation();
            await db.SaveChangesAsync(t); await tx.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw OperationalTaskException.Conflict("stale_version"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        { throw OperationalTaskException.Conflict("task_duplicate_command"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23503" or "23514" })
        { throw OperationalTaskException.Conflict("task_dependency_conflict"); }
    }
    public Task<TaskLocation?> LocationAsync(Guid id, CancellationToken t) => db.Locations.AsNoTracking().Where(x => x.Id == id)
        .Select(x => new TaskLocation(x.Id, x.IsActive)).SingleOrDefaultAsync(t);
    public Task<string?> TargetRoomNameAsync(Guid locationId, Guid roomId, CancellationToken t) => db.Set<Room>().AsNoTracking()
        .Where(x => x.Id == roomId && x.LocationId == locationId).Select(x => x.RoomNumber).SingleOrDefaultAsync(t);
    public Task<TaskTargetOption?> TargetAssetAsync(Guid locationId, Guid assetId, CancellationToken t) => db.Set<Asset>().AsNoTracking()
        .Where(x => x.Id == assetId && x.LocationId == locationId && x.Status != AssetStatus.Retired)
        .Select(x => new TaskTargetOption(x.Id, x.Name, x.RoomId, x.CommonArea)).SingleOrDefaultAsync(t);
    public async Task<IReadOnlyList<string>> CommonAreasAsync(Guid locationId, CancellationToken t) => await db.Set<Asset>().AsNoTracking()
        .Where(x => x.LocationId == locationId && x.RoomId == null && x.CommonArea != null && x.Status != AssetStatus.Retired)
        .Select(x => x.CommonArea!).Distinct().OrderBy(x => x).ToArrayAsync(t);
    public async Task<TaskPage<TaskTargetOption>> TargetAssetsAsync(Guid locationId, Guid? roomId, string? commonArea, string? search, int page, int pageSize, CancellationToken t)
    {
        var rows = db.Set<Asset>().AsNoTracking().Where(x => x.LocationId == locationId && x.RoomId == roomId && x.CommonArea == commonArea && x.Status != AssetStatus.Retired);
        if (!string.IsNullOrWhiteSpace(search)) rows = rows.Where(x => EF.Functions.ILike(x.Name, "%" + search.Trim() + "%"));
        var total = await rows.CountAsync(t);
        var items = await rows.OrderBy(x => x.Name).ThenBy(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(x => new TaskTargetOption(x.Id, x.Name, x.RoomId, x.CommonArea)).ToArrayAsync(t);
        return new(items, page, pageSize, total);
    }
    public Task<OperationalTask?> FindAsync(Guid id, CancellationToken t) => db.Set<OperationalTask>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, t);
    public Task<MeterTaskStatus?> MoveInMainTaskStatusAsync(Guid contractId, CancellationToken t) =>
        db.Set<OperationalTask>().AsNoTracking()
            .Where(task => task.ContractId == contractId && task.Kind == OperationalTaskKind.AdHoc &&
                task.Title.StartsWith("Bàn giao vào phòng"))
            .OrderBy(task => task.CreatedAt).ThenBy(task => task.Id)
            .Select(task => (MeterTaskStatus?)task.Status)
            .FirstOrDefaultAsync(t);
    public Task<LocationAssetInventorySnapshot> OwnerConfirmedInventoryAsync(OperationalTask task, CancellationToken t)
    {
        if (db is not Compact24DbContext compact) throw OperationalTaskException.Conflict("owner_inventory_compact_required");
        return LocationAssetInventoryTaskFactory.BuildConfirmedSnapshotAsync(compact, workspace,
            task.LocationId, task.AssignmentId ?? Guid.Empty, task.ReadingDate, DateTimeOffset.UtcNow, t);
    }
    public async Task<IReadOnlyList<TaskIncidentTarget>> IncidentTargetsAsync(Guid[] ids, CancellationToken t) =>
        await db.Set<IncidentReport>().AsNoTracking().Where(x => ids.Contains(x.Id))
            .Select(x => new TaskIncidentTarget(x.Id, x.LocationId, x.RoomId, x.AssetId, x.ReporterId,
                x.Status == IncidentStatus.Submitted || x.Status == IncidentStatus.InProgress ||
                x.Status == IncidentStatus.Resolved)).ToArrayAsync(t);
    public async Task<bool> IncidentsResolvedAsync(Guid[] incidentIds, CancellationToken t)
    {
        var ids = incidentIds.Distinct().ToArray();
        return ids.Length == 0 || await db.Set<IncidentReport>().AsNoTracking()
            .CountAsync(x => ids.Contains(x.Id) && x.Status == IncidentStatus.Resolved, t) == ids.Length;
    }
    public async Task NotifyMoveInInventoryCompletedAsync(OperationalTask task, Guid actor, CancellationToken t)
    {
        if (inbox is null) return;
        foreach (var owner in (await OwnersAsync(t)).Where(x => x != actor))
            await inbox.Emit(owner, Roles.Owner, task.LocationId,
                $"move-in-inventory-completed:{task.Id:N}:{owner:N}",
                "MOVE_IN_INVENTORY_COMPLETED", "OperationalTask", "Kiểm kê trước nhận phòng đã hoàn thành",
                $"Công việc kiểm kê {task.TargetLabel ?? task.Title} đã hoàn thành. Mở công việc để xem các mục đã kiểm và sự cố liên quan.",
                "OperationalTask", task.Id, t);
    }
    public Task<TaskResponsibility?> ResponsibilityAsync(Guid locationId, DateOnly date, CancellationToken t) =>
        (from assignment in db.StaffLocationAssignments.AsNoTracking()
         join staff in db.Users on assignment.StaffUserId equals staff.Id
         where assignment.LocationId == locationId && assignment.StartDate <= date && assignment.EndDate >= date && staff.IsActive &&
             db.UserRoles.Any(ur => ur.UserId == staff.Id && db.Roles.Any(role => role.Id == ur.RoleId && role.Name == Roles.Staff)) &&
             EligibleStaff(date).Contains(staff.Id)
         select new TaskResponsibility(assignment.Id, staff.Id)).SingleOrDefaultAsync(t);

    private IQueryable<Guid> EligibleStaff(DateOnly date) => db is Compact24DbContext compact
        ? StaffEmploymentEligibility.EligibleIds(compact, date)
        : db.Users.Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
            db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))).Select(u => u.Id);

    private IQueryable<OperationalTask> Visible(Guid? staffId, DateOnly date)
    {
        var rows = db.Set<OperationalTask>().AsNoTracking();
        if (staffId is { } staff) rows = rows.Where(task => task.Location.IsActive && EligibleStaff(date).Contains(staff) &&
            db.StaffLocationAssignments.Any(a => a.LocationId == task.LocationId && a.StaffUserId == staff && a.StartDate <= date && a.EndDate >= date) &&
            db.Users.Any(u => u.Id == staff && u.IsActive && db.UserRoles.Any(ur => ur.UserId == staff && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))));
        return rows;
    }
    public async Task<TaskPage<TaskView>> ListAsync(TaskQuery query, Guid? staffId, DateOnly date, DateTimeOffset now, CancellationToken t)
    {
        // Meter-specific actions remain on capture APIs; expose only the UC-10..12 work list here.
        var rows = Visible(staffId, date).Where(x => x.Kind == OperationalTaskKind.AdHoc || x.Kind == OperationalTaskKind.MoveInInventory || x.Kind == OperationalTaskKind.LocationAssetHandover);
        if (staffId is not null)
        {
            // Keep the original inventory checkpoint (history, incident links and
            // completion gates) but expose it to Staff inside the canonical
            // "Bàn giao vào phòng" job. Filter BEFORE Count/Skip/Take so a page
            // never appears empty because it contained only hidden checkpoints.
            // Owner management queries still see both underlying records.
            rows = rows.Where(task => task.Kind != OperationalTaskKind.MoveInInventory ||
                task.ContractId == null || !db.Set<OperationalTask>().Any(moveIn =>
                    moveIn.ContractId == task.ContractId &&
                    moveIn.Kind == OperationalTaskKind.AdHoc &&
                    moveIn.Title.StartsWith("Bàn giao vào phòng")));
        }
        if (staffId.HasValue)
            rows = rows.Where(x => x.Kind != OperationalTaskKind.LocationAssetHandover ||
                db.StaffLocationAssignments.Any(a => a.Id == x.AssignmentId && a.StaffUserId == staffId.Value && a.StartDate <= date && a.EndDate >= date));
        if (query.LocationId is { } location) rows = rows.Where(x => x.LocationId == location);
        if (query.RecordedStaffUserId is { } recorded) rows = rows.Where(x => x.AssignedStaffUserId == recorded);
        if (query.HasResponsibility is { } available) rows = rows.Where(task =>
            (task.Location.IsActive && db.StaffLocationAssignments.Any(a => a.LocationId == task.LocationId && a.StartDate <= date && a.EndDate >= date &&
                db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive && EligibleStaff(date).Contains(u.Id) && db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))))) == available);
        if (query.Status is { } status) rows = rows.Where(x => x.Status == status);
        if (query.Priority is { } priority) rows = rows.Where(x => x.Priority == priority);
        if (query.DueFrom is { } from) rows = rows.Where(x => x.DueAt >= from);
        if (query.DueTo is { } to) rows = rows.Where(x => x.DueAt <= to);
        if (query.IsOverdue is { } overdue) rows = rows.Where(x => (x.DueAt < now && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled) == overdue);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderBy(x => x.DueAt).ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(task => new
            {
                Task = task,
                Responsible = db.StaffLocationAssignments.Where(a => task.Location.IsActive && a.LocationId == task.LocationId && a.StartDate <= date && a.EndDate >= date &&
                    db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive && EligibleStaff(date).Contains(u.Id) && db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))))
                    .Select(a => (Guid?)a.StaffUserId).SingleOrDefault()
            }).ToArrayAsync(t);
        return new(items.Select(x => new TaskView(x.Task.Id, x.Task.LocationId, x.Task.Kind.ToString(), x.Task.Title, x.Task.Requirements,
            x.Task.Priority.ToString(), x.Task.DueAt, x.Task.EvidenceRequired, x.Task.Status.ToString(), x.Task.IsOverdue(now), x.Responsible,
            x.Task.AssignedStaffUserId, x.Responsible != null, x.Task.Result, x.Task.Version, x.Task.VerifiedByUserId, x.Task.VerifiedAt,
            x.Task.CreatedAt, x.Task.UpdatedAt, OperationalTaskService.TargetView(x.Task))).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<TaskPage<TaskHistoryView>> HistoryAsync(Guid taskId, int page, int size, CancellationToken t)
    {
        var rows = db.Set<OperationalTaskHistory>().AsNoTracking().Where(x => x.TaskId == taskId);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(x => x.OccurredAt).ThenByDescending(x => x.Id).Skip((page - 1) * size).Take(size)
            .Select(x => new TaskHistoryView(x.Id, x.ActorId, x.Action, x.Note, x.ChangesJson, x.ResponsibleStaffUserId, x.OccurredAt, x.WasOverdue, x.TaskVersion)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public async Task<IReadOnlyList<TaskActorView>> ActorsAsync(Guid taskId, CancellationToken t)
    {
        var actorIds = db.Set<OperationalTaskHistory>().AsNoTracking().Where(x => x.TaskId == taskId)
            .Select(x => x.ActorId).Distinct();
        var entity = db.Model.FindEntityType(typeof(ApplicationUser));
        if (entity?.FindProperty("full_name") is not null)
            return await db.Users.AsNoTracking().Where(x => actorIds.Contains(x.Id))
                .Select(x => new TaskActorView(x.Id,
                    EF.Property<string>(x, "full_name") ?? x.Email ?? x.UserName ?? x.Id.ToString()))
                .OrderBy(x => x.DisplayName).ToArrayAsync(t);
        return await db.Users.AsNoTracking().Where(x => actorIds.Contains(x.Id))
            .Select(x => new TaskActorView(x.Id, x.Email ?? x.UserName ?? x.Id.ToString()))
            .OrderBy(x => x.DisplayName).ToArrayAsync(t);
    }
    public Task<OperationalTaskCommand?> CommandAsync(Guid actorId, Guid key, CancellationToken t) => db.Set<OperationalTaskCommand>().AsNoTracking()
        .SingleOrDefaultAsync(x => x.ActorId == actorId && x.Key == key, t);
    public async Task<IReadOnlyList<OperationalTaskEvidence>> EvidenceAsync(Guid taskId, CancellationToken t) =>
        await db.Set<OperationalTaskEvidence>().Where(x => x.TaskId == taskId).OrderBy(x => x.CreatedAt).ToArrayAsync(t);
    public async Task<IReadOnlyList<Guid>> OwnersAsync(CancellationToken t) => await db.Users.AsNoTracking().Where(u => u.IsActive &&
        db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Owner))).Select(u => u.Id).ToArrayAsync(t);
    public async Task<TaskPage<TaskNotificationView>> NotificationsAsync(Guid userId, Guid? staffId, DateOnly date, int page, int size, CancellationToken t)
    {
        var visibleIds = Visible(staffId, date).Select(task => task.Id);
        var rows = db.Set<OperationalTaskNotification>().AsNoTracking().Where(n => n.RecipientUserId == userId && visibleIds.Contains(n.TaskId));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id).Skip((page - 1) * size).Take(size)
            .Select(x => new TaskNotificationView(x.Id, x.TaskId, x.Event, x.CreatedAt, x.ReadAt)).ToArrayAsync(t);
        return new(items, page, size, count);
    }
    public Task<OperationalTaskNotification?> NotificationAsync(Guid id, Guid recipient, CancellationToken t) =>
        db.Set<OperationalTaskNotification>().SingleOrDefaultAsync(x => x.Id == id && x.RecipientUserId == recipient, t);
    public Task FlushAsync(CancellationToken t) => db.SaveChangesAsync(t);
    public void Add(object entity) => db.Add(entity);
    public void Track(OperationalTask task)
    {
        // Consecutive inspection start/submit commands have flushed the previous root.
        // Replace that unchanged instance with the row re-read under the enclosing lock.
        var previous = db.ChangeTracker.Entries<OperationalTask>().SingleOrDefault(entry => entry.Entity.Id == task.Id);
        if (previous is not null && !ReferenceEquals(previous.Entity, task))
        {
            if (previous.State != EntityState.Unchanged) throw OperationalTaskException.Conflict("task_changes_not_flushed");
            previous.State = EntityState.Detached;
        }
        db.Attach(task);
    }
    public void Audit(Guid actorId, string action, Guid taskId, DateTimeOffset now) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actorId, Event = action, TargetType = "OperationalTask", TargetId = taskId, Succeeded = true, OccurredAt = now });
}
