using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;

namespace BHome.Application.StaffOperations;

public sealed class OperationalTaskService(IOperationalTaskRepository repository, ICurrentUser user,
    PermissionAccess permissions, ITaskEvidenceFiles files, TaskEvidenceLimits limits, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new OperationalTaskException(401, "authentication_required");
    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
    private bool Owner => user.IsInRole(Roles.Owner);
    private Guid? StaffFilter => Owner ? null : Actor;
    private void Permit(string permission)
    {
        _ = Actor;
        if (!permissions.HasPermission(permission)) throw new OperationalTaskException(403, "task_permission_denied");
    }
    private static void Validate(object? input)
    {
        if (input is null || !Validator.TryValidateObject(input, new ValidationContext(input), [], true))
            throw OperationalTaskException.Invalid("invalid_task_input");
        // Record validation annotations are on constructor parameters (also used by MVC).
        foreach (var parameter in input.GetType().GetConstructors().OrderByDescending(x => x.GetParameters().Length).First().GetParameters())
        {
            var value = input.GetType().GetProperty(parameter.Name!)?.GetValue(input);
            foreach (var attribute in parameter.GetCustomAttributes(typeof(ValidationAttribute), true).Cast<ValidationAttribute>())
                if (!attribute.IsValid(value)) throw OperationalTaskException.Invalid("invalid_task_input");
        }
    }
    private static void Page(int page, int size)
    { if (page is < 1 or > 1000000 || size is < 1 or > 100) throw OperationalTaskException.Invalid("invalid_pagination"); }
    private async Task<TaskResponsibility?> AccessAsync(OperationalTask task, CancellationToken t, bool requireAssigned = false)
    {
        var location = await repository.LocationAsync(task.LocationId, t) ?? throw OperationalTaskException.Missing();
        var responsible = location.IsActive ? await repository.ResponsibilityAsync(task.LocationId, Today, t) : null;
        if ((!Owner || requireAssigned) && (responsible is null || responsible.StaffUserId != Actor)) throw OperationalTaskException.Missing();
        return responsible;
    }
    private static TaskView View(OperationalTask task, TaskResponsibility? responsible) => new(task.Id, task.LocationId,
        task.Kind.ToString(), task.Title, task.Requirements, task.Priority.ToString(), task.DueAt, task.EvidenceRequired,
        task.Status.ToString(), false, responsible?.StaffUserId, task.AssignedStaffUserId, responsible is not null,
        task.Result, task.Version, task.VerifiedByUserId, task.VerifiedAt, task.CreatedAt, task.UpdatedAt);
    private TaskView CurrentView(OperationalTask task, TaskResponsibility? responsible) => View(task, responsible) with { IsOverdue = task.IsOverdue(Now) };

    public async Task<TaskPage<TaskView>> ListAsync(TaskQuery query, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.View); Page(query.Page, query.PageSize);
        if (query.Status is { } s && !Enum.IsDefined(s) || query.Priority is { } p && !Enum.IsDefined(p) ||
            query.LocationId == Guid.Empty || query.DueFrom > query.DueTo) throw OperationalTaskException.Invalid("invalid_task_filter");
        return await repository.ListAsync(query, StaffFilter, Today, Now, t);
    }
    public async Task<TaskView> GetAsync(Guid id, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.View);
        var task = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
        return CurrentView(task, await AccessAsync(task, t));
    }
    public async Task<TaskPage<TaskHistoryView>> HistoryAsync(Guid id, int page, int size, CancellationToken t)
    { await GetAsync(id, t); Page(page, size); return await repository.HistoryAsync(id, page, size, t); }

    public async Task<TaskView> CreateAsync(TaskCreate input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Manage); Validate(input); Validate(input.Work);
        if (input.LocationId == Guid.Empty) throw OperationalTaskException.Invalid("location_required");
        return await CommandAsync(input.LocationId, key, "create", input, async () =>
        {
            var location = await repository.LocationAsync(input.LocationId, t) ?? throw OperationalTaskException.Missing();
            if (!location.IsActive) throw OperationalTaskException.Conflict("location_inactive");
            var responsible = await repository.ResponsibilityAsync(location.Id, Today, t) ?? throw OperationalTaskException.Conflict("no_responsible_staff");
            var task = new OperationalTask { Kind = OperationalTaskKind.AdHoc, LocationId = location.Id,
                AssignedStaffUserId = responsible.StaffUserId, AssignmentId = responsible.AssignmentId, AssignedAt = Now };
            SetWork(task, input.Work); repository.Add(task);
            await RecordAsync(task, "created", "", new { input.Work, responsible.AssignmentId }, [responsible.StaffUserId], t);
            await repository.FlushAsync(t);
            return CurrentView(task, responsible);
        }, result => result.Id, t);
    }
    private void SetWork(OperationalTask task, TaskWrite work)
    {
        Validate(work);
        if (string.IsNullOrWhiteSpace(work.Title) || string.IsNullOrWhiteSpace(work.Requirements) || !Enum.IsDefined(work.Priority) ||
            work.DueAt == default || (work.DueAt != task.DueAt && work.DueAt <= Now)) throw OperationalTaskException.Invalid("invalid_task_work_or_deadline");
        task.Title = work.Title.Trim(); task.Requirements = work.Requirements.Trim(); task.Priority = work.Priority;
        task.DueAt = work.DueAt.ToUniversalTime(); task.EvidenceRequired = work.EvidenceRequired;
    }
    public Task<TaskView> UpdateAsync(Guid id, TaskUpdate input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Manage); Validate(input); Validate(input.Work);
        if (string.IsNullOrWhiteSpace(input.Reason)) throw OperationalTaskException.Invalid("reason_required");
        return MutateAsync(id, input.Version, key, "update", input, async (task, responsible) =>
        {
            if (task.Status is not (MeterTaskStatus.Assigned or MeterTaskStatus.InProgress)) throw OperationalTaskException.Conflict("task_not_editable");
            var before = new { task.Title, task.Requirements, task.Priority, task.DueAt, task.EvidenceRequired };
            var wasOverdue = task.IsOverdue(Now);
            SetWork(task, input.Work);
            await RecordAsync(task, "updated", input.Reason, new { Before = before, After = input.Work }, Recipients(responsible), t, wasOverdue);
        }, t);
    }
    public Task<TaskView> ActAsync(Guid id, string action, TaskAction input, Guid key, CancellationToken t)
    {
        var permission = action switch
        {
            "start" or "progress" or "blockers" or "submit" => Permissions.OperationalTasks.Execute,
            "verify" or "rework" => Permissions.OperationalTasks.Verify,
            "assign" or "coordinate" or "cancel" => Permissions.OperationalTasks.Manage,
            _ => throw OperationalTaskException.Invalid("unknown_task_action")
        };
        Permit(permission); Validate(input);
        if (action is "progress" or "blockers" or "submit" or "rework" or "cancel" or "coordinate" && string.IsNullOrWhiteSpace(input.Note))
            throw OperationalTaskException.Invalid("task_note_required");
        return MutateAsync(id, input.Version, key, action, input, async (task, responsible) =>
        {
            if (action == "assign")
            {
                if (task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled) throw OperationalTaskException.Conflict("task_closed");
                if (responsible is null) throw OperationalTaskException.Conflict("no_responsible_staff");
                return; // Routing synchronization is performed centrally below, with history only on change.
            }
            var evidence = await repository.EvidenceAsync(id, t);
            var ids = input.EvidenceIds ?? [];
            if (ids.Distinct().Count() != ids.Length || ids.Any(e => evidence.All(x => x.Id != e)))
                throw OperationalTaskException.Invalid("invalid_task_evidence");
            if (action == "submit")
            {
                if (task.EvidenceRequired && ids.Length == 0) throw OperationalTaskException.Conflict("completion_evidence_required");
                foreach (var image in evidence.Where(x => ids.Contains(x.Id)))
                {
                    // Private object availability is revalidated before recording completion evidence.
                    await files.CopyAsync(image.ObjectKey, Stream.Null, t);
                    image.SubmissionId = key;
                }
                task.Result = input.Note!.Trim();
            }
            else if (ids.Length > 0 && action is not ("progress" or "blockers")) throw OperationalTaskException.Invalid("evidence_not_supported_for_action");
            if (action == "verify" && task.EvidenceRequired)
            {
                var latest = evidence.Where(x => x.SubmissionId != null).ToArray();
                if (latest.Length == 0) throw OperationalTaskException.Conflict("completion_evidence_required");
                foreach (var image in latest) await files.CopyAsync(image.ObjectKey, Stream.Null, t);
            }
            var wasOverdue = task.IsOverdue(Now);
            try { task.ApplyAction(action, Now, Actor); }
            catch (InvalidOperationException e) { throw OperationalTaskException.Conflict(e.Message); }
            if (action == "rework")
            {
                // Prior submission selections remain in immutable history; the next submission is explicit.
                foreach (var image in evidence) image.SubmissionId = null;
            }
            var recipients = action is "submit" or "blockers" ? await repository.OwnersAsync(t) : Recipients(responsible);
            await RecordAsync(task, action, input.Note?.Trim() ?? "", new { EvidenceIds = ids, task.Status }, recipients, t, wasOverdue);
        }, t);
    }
    private static Guid[] Recipients(TaskResponsibility? responsible) => responsible is null ? [] : [responsible.StaffUserId];
    private async Task<TaskView> MutateAsync(Guid id, int version, Guid key, string action, object input,
        Func<OperationalTask, TaskResponsibility?, Task> change, CancellationToken t)
    {
        var initial = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
        var executing = action is "start" or "progress" or "blockers" or "submit";
        await AccessAsync(initial, t, executing);
        return await CommandAsync(initial.LocationId, key, action + ":" + id, input, async () =>
        {
            var task = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
            var responsible = await AccessAsync(task, t, executing);
            if (task.Kind != OperationalTaskKind.AdHoc) throw OperationalTaskException.Conflict("meter_workflow_required");
            if (task.Version != version) throw OperationalTaskException.Conflict("stale_version");
            repository.Track(task);
            var routingChanged = await SynchronizeResponsibilityAsync(task, responsible, t);
            await change(task, responsible);
            if (action != "assign" || routingChanged) task.Version++;
            await repository.FlushAsync(t);
            return CurrentView(task, responsible);
        }, result => result.Id, t);
    }
    private async Task<bool> SynchronizeResponsibilityAsync(OperationalTask task, TaskResponsibility? responsible, CancellationToken t)
    {
        var changed = task.AssignmentId != responsible?.AssignmentId || task.AssignedStaffUserId != responsible?.StaffUserId;
        if (!changed || task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled) return false;
        var previous = new { task.AssignedStaffUserId, task.AssignmentId };
        task.AssignedStaffUserId = responsible?.StaffUserId; task.AssignmentId = responsible?.AssignmentId; task.AssignedAt = Now;
        await RecordAsync(task, "responsibility_changed", "", new { Before = previous, After = responsible }, Recipients(responsible), t);
        return true;
    }
    private Task RecordAsync(OperationalTask task, string action, string note, object changes, IReadOnlyList<Guid> recipients, CancellationToken t, bool? wasOverdue = null)
    {
        var history = new OperationalTaskHistory { TaskId = task.Id, ActorId = Actor, Action = action, Note = note,
            ChangesJson = JsonSerializer.Serialize(changes), ResponsibleStaffUserId = task.AssignedStaffUserId,
            OccurredAt = Now, WasOverdue = wasOverdue ?? task.IsOverdue(Now), TaskVersion = action == "created" ? task.Version : task.Version + 1 };
        repository.Add(history);
        if (action is "created" or "updated" or "assign" or "responsibility_changed" or "submit" or "verify" or "rework" or "cancel" or "blockers" or "coordinate")
            foreach (var recipient in recipients.Distinct().Where(x => x != Actor)) repository.Add(new OperationalTaskNotification
            { TaskId = task.Id, RecipientUserId = recipient, EventId = history.Id, Event = action });
        if (action is "created" or "updated" or "responsibility_changed" or "verify" or "rework" or "cancel")
            repository.Audit(Actor, "Task_" + action, task.Id, Now);
        return Task.CompletedTask;
    }
    private async Task<T> CommandAsync<T>(Guid location, Guid key, string operation, object input, Func<Task<T>> work, Func<T, Guid> taskId, CancellationToken t)
    {
        if (key == Guid.Empty) throw OperationalTaskException.Invalid("idempotency_key_required");
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(operation + "\n" + JsonSerializer.Serialize(input))));
        return await repository.TransactionAsync(location, Actor, key, async () =>
        {
            var existing = await repository.CommandAsync(Actor, key, t);
            if (existing is not null)
            {
                if (existing.Fingerprint != fingerprint) throw OperationalTaskException.Conflict("idempotency_conflict");
                return JsonSerializer.Deserialize<T>(existing.ResponseJson)!;
            }
            var result = await work();
            repository.Add(new OperationalTaskCommand { ActorId = Actor, Key = key, TaskId = taskId(result),
                Fingerprint = fingerprint, ResponseJson = JsonSerializer.Serialize(result) });
            return result;
        }, t);
    }

    public async Task<IReadOnlyList<TaskEvidenceView>> EvidenceAsync(Guid id, CancellationToken t)
    {
        await GetAsync(id, t);
        return (await repository.EvidenceAsync(id, t)).Select(EvidenceView).ToArray();
    }
    private static TaskEvidenceView EvidenceView(OperationalTaskEvidence e) => new(e.Id, e.ContentType, e.Length, e.UploadedByUserId, e.CreatedAt, e.SubmissionId);
    public async Task<TaskEvidenceView> UploadAsync(Guid id, Guid key, Stream input, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Execute);
        var initial = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(initial, t, true);
        var bytes = new byte[limits.MaximumFileBytes + 1];
        try
        {
            var length = 0;
            while (length < bytes.Length)
            {
                var read = await input.ReadAsync(bytes.AsMemory(length), t); if (read == 0) break; length += read;
            }
            if (length > limits.MaximumFileBytes) throw new OperationalTaskException(413, "task_evidence_too_large");
            var content = bytes.AsSpan(0, length).ToArray();
            try
            {
                var type = files.Validate(content, limits.MaximumFileBytes);
                var hash = Convert.ToHexString(SHA256.HashData(content));
                return await CommandAsync(initial.LocationId, key, "evidence:" + id, new { Hash = hash, Type = type }, async () =>
                {
                    var task = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
                    var responsible = await AccessAsync(task, t, true);
                    if (task.Kind != OperationalTaskKind.AdHoc) throw OperationalTaskException.Conflict("meter_workflow_required");
                    if (task.Status != MeterTaskStatus.InProgress) throw OperationalTaskException.Conflict("task_not_in_progress");
                    if ((await repository.EvidenceAsync(id, t)).Count >= limits.MaximumFilesPerTask) throw OperationalTaskException.Conflict("task_evidence_limit");
                    repository.Track(task);
                    await SynchronizeResponsibilityAsync(task, responsible, t);
                    var evidence = new OperationalTaskEvidence { TaskId = id, UploadedByUserId = Actor, ContentType = type, Length = length,
                        Sha256 = hash, ObjectKey = "task-evidence/" + id.ToString("N") + "/" + Guid.NewGuid().ToString("N") };
                    await files.PutAsync(id, evidence.ObjectKey, content, type, t);
                    repository.Add(evidence);
                    await RecordAsync(task, "evidence_uploaded", "", new { EvidenceId = evidence.Id }, [], t);
                    task.Version++;
                    await repository.FlushAsync(t);
                    return EvidenceView(evidence);
                }, _ => id, t);
            }
            finally { CryptographicOperations.ZeroMemory(content); }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<string> CopyEvidenceAsync(Guid id, Guid evidenceId, Stream output, CancellationToken t)
    {
        await GetAsync(id, t);
        var evidence = (await repository.EvidenceAsync(id, t)).SingleOrDefault(x => x.Id == evidenceId) ?? throw OperationalTaskException.Missing();
        await files.CopyAsync(evidence.ObjectKey, output, t); return evidence.ContentType;
    }
    public Task<TaskPage<TaskNotificationView>> NotificationsAsync(int page, int size, CancellationToken t)
    {
        Permit(Permissions.Notifications.ReadOwn); Permit(Permissions.OperationalTasks.View); Page(page, size);
        return repository.NotificationsAsync(Actor, StaffFilter, Today, page, size, t);
    }
    public async Task MarkReadAsync(Guid id, CancellationToken t)
    {
        Permit(Permissions.Notifications.ReadOwn);
        var item = await repository.NotificationAsync(id, Actor, t) ?? throw OperationalTaskException.Missing();
        await GetAsync(item.TaskId, t);
        item.ReadAt ??= Now; await repository.FlushAsync(t);
    }
}
