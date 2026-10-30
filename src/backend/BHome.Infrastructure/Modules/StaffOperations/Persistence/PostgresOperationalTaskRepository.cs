using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.StaffOperations.Persistence;

internal sealed class PostgresOperationalTaskRepository(BHomeDbContext db) : IOperationalTaskRepository
{
    public async Task<T> TransactionAsync<T>(Guid locationId, Guid actorId, Guid commandKey, Func<Task<T>> operation, CancellationToken t)
    {
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
    public Task<OperationalTask?> FindAsync(Guid id, CancellationToken t) => db.Set<OperationalTask>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, t);
    public Task<TaskResponsibility?> ResponsibilityAsync(Guid locationId, DateOnly date, CancellationToken t) =>
        (from assignment in db.StaffLocationAssignments.AsNoTracking()
         join staff in db.Users on assignment.StaffUserId equals staff.Id
         where assignment.LocationId == locationId && assignment.StartDate <= date && assignment.EndDate >= date && staff.IsActive &&
             db.UserRoles.Any(ur => ur.UserId == staff.Id && db.Roles.Any(role => role.Id == ur.RoleId && role.Name == Roles.Staff))
         select new TaskResponsibility(assignment.Id, staff.Id)).SingleOrDefaultAsync(t);

    private IQueryable<OperationalTask> Visible(Guid? staffId, DateOnly date)
    {
        var rows = db.Set<OperationalTask>().AsNoTracking();
        if (staffId is { } staff) rows = rows.Where(task => task.Location.IsActive &&
            db.StaffLocationAssignments.Any(a => a.LocationId == task.LocationId && a.StaffUserId == staff && a.StartDate <= date && a.EndDate >= date) &&
            db.Users.Any(u => u.Id == staff && u.IsActive && db.UserRoles.Any(ur => ur.UserId == staff && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))));
        return rows;
    }
    public async Task<TaskPage<TaskView>> ListAsync(TaskQuery query, Guid? staffId, DateOnly date, DateTimeOffset now, CancellationToken t)
    {
        // Meter-specific actions remain on capture APIs; expose only the UC-10..12 work list here.
        var rows = Visible(staffId, date).Where(x => x.Kind == OperationalTaskKind.AdHoc);
        if (query.LocationId is { } location) rows = rows.Where(x => x.LocationId == location);
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
                    db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))))
                    .Select(a => (Guid?)a.StaffUserId).SingleOrDefault()
            }).ToArrayAsync(t);
        return new(items.Select(x => new TaskView(x.Task.Id, x.Task.LocationId, x.Task.Kind.ToString(), x.Task.Title, x.Task.Requirements,
            x.Task.Priority.ToString(), x.Task.DueAt, x.Task.EvidenceRequired, x.Task.Status.ToString(), x.Task.IsOverdue(now), x.Responsible,
            x.Task.AssignedStaffUserId, x.Responsible != null, x.Task.Result, x.Task.Version, x.Task.VerifiedByUserId, x.Task.VerifiedAt,
            x.Task.CreatedAt, x.Task.UpdatedAt)).ToArray(), query.Page, query.PageSize, count);
    }
    public async Task<TaskPage<TaskHistoryView>> HistoryAsync(Guid taskId, int page, int size, CancellationToken t)
    {
        var rows = db.Set<OperationalTaskHistory>().AsNoTracking().Where(x => x.TaskId == taskId);
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(x => x.OccurredAt).ThenByDescending(x => x.Id).Skip((page - 1) * size).Take(size)
            .Select(x => new TaskHistoryView(x.Id, x.ActorId, x.Action, x.Note, x.ChangesJson, x.ResponsibleStaffUserId, x.OccurredAt, x.WasOverdue, x.TaskVersion)).ToArrayAsync(t);
        return new(items, page, size, count);
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
    public void Track(OperationalTask task) => db.Attach(task);
    public void Audit(Guid actorId, string action, Guid taskId, DateTimeOffset now) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actorId, Event = action, TargetType = "OperationalTask", TargetId = taskId, Succeeded = true, OccurredAt = now });
}
