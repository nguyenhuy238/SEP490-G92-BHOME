using BHome.Application.IdentityAccess;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;

namespace BHome.Application.UnitTests.UnitTestDoc.BF02;

// Bản giả (test double) dùng chung cho sheet "BF-02 Staff Tasks".
// Chỉ dựng dữ liệu theo Điều kiện của sheet; không chứa quy tắc nghiệp vụ nào.

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}

internal sealed class FakeCurrentUser : ICurrentUser
{
    public Guid? UserId { get; set; }
    public string? Role { get; set; }
    public bool IsInRole(string role) => Role == role;
}

// Phân công Staff - Location hiện tại (Location -> Staff phụ trách).
internal sealed class FakeStaffLocations : IStaffLocationAccess
{
    public Dictionary<Guid, Guid> ResponsibleByLocation { get; } = [];

    public Task<bool> IsAssignedAsync(Guid staffId, Guid locationId, CancellationToken cancellationToken) =>
        Task.FromResult(ResponsibleByLocation.TryGetValue(locationId, out var staff) && staff == staffId);
}

internal sealed class InMemoryTaskRepository(FakeStaffLocations assignments) : IOperationalTaskRepository
{
    public Dictionary<Guid, TaskLocation> Locations { get; } = [];
    public Dictionary<Guid, OperationalTask> Tasks { get; } = [];
    public List<object> Added { get; } = [];
    public List<Guid> Owners { get; } = [];
    private readonly Dictionary<Guid, Guid> assignmentIds = [];

    public IEnumerable<OperationalTaskHistory> Histories(Guid taskId) => Added.OfType<OperationalTaskHistory>().Where(h => h.TaskId == taskId);
    public IEnumerable<OperationalTaskEvidence> Evidence(Guid taskId) => Added.OfType<OperationalTaskEvidence>().Where(e => e.TaskId == taskId);
    public IEnumerable<OperationalTaskNotification> Notifications(Guid taskId) => Added.OfType<OperationalTaskNotification>().Where(n => n.TaskId == taskId);
    public IEnumerable<OperationalTask> AllTasks() => Tasks.Values.Concat(Added.OfType<OperationalTask>()).Distinct();

    public Guid AssignmentOf(Guid locationId)
    {
        if (!assignmentIds.TryGetValue(locationId, out var id)) assignmentIds[locationId] = id = Guid.NewGuid();
        return id;
    }

    public Task<T> TransactionAsync<T>(Guid locationId, Guid actorId, Guid commandKey, Func<Task<T>> operation, CancellationToken t) => operation();

    public Task<TaskLocation?> LocationAsync(Guid id, CancellationToken t) =>
        Task.FromResult(Locations.TryGetValue(id, out var location) ? location : null);

    public Task<OperationalTask?> FindAsync(Guid id, CancellationToken t) =>
        Task.FromResult(AllTasks().FirstOrDefault(task => task.Id == id));

    public Task<TaskResponsibility?> ResponsibilityAsync(Guid locationId, DateOnly date, CancellationToken t) =>
        Task.FromResult(assignments.ResponsibleByLocation.TryGetValue(locationId, out var staff)
            ? new TaskResponsibility(AssignmentOf(locationId), staff)
            : null);

    public Task<TaskPage<TaskView>> ListAsync(TaskQuery query, Guid? staffId, DateOnly date, DateTimeOffset now, CancellationToken t) =>
        Task.FromResult(new TaskPage<TaskView>([], query.Page, query.PageSize, 0));

    public Task<TaskPage<TaskHistoryView>> HistoryAsync(Guid taskId, int page, int size, CancellationToken t)
    {
        var items = Histories(taskId).Select(h => new TaskHistoryView(h.Id, h.ActorId, h.Action, h.Note, h.ChangesJson,
            h.ResponsibleStaffUserId, h.OccurredAt, h.WasOverdue, h.TaskVersion)).ToArray();
        return Task.FromResult(new TaskPage<TaskHistoryView>(items, page, size, items.Length));
    }

    public Task<OperationalTaskCommand?> CommandAsync(Guid actorId, Guid key, CancellationToken t) => Task.FromResult<OperationalTaskCommand?>(null);

    public Task<IReadOnlyList<OperationalTaskEvidence>> EvidenceAsync(Guid taskId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<OperationalTaskEvidence>>(Evidence(taskId).ToArray());

    public Task<IReadOnlyList<Guid>> OwnersAsync(CancellationToken t) => Task.FromResult<IReadOnlyList<Guid>>(Owners.ToArray());

    public Task<TaskPage<TaskNotificationView>> NotificationsAsync(Guid userId, Guid? staffId, DateOnly date, int page, int size, CancellationToken t) =>
        Task.FromResult(new TaskPage<TaskNotificationView>([], page, size, 0));

    public Task<OperationalTaskNotification?> NotificationAsync(Guid id, Guid recipient, CancellationToken t) =>
        Task.FromResult(Added.OfType<OperationalTaskNotification>().FirstOrDefault(n => n.Id == id && n.RecipientUserId == recipient));

    public Task FlushAsync(CancellationToken t) => Task.CompletedTask;

    public void Add(object entity)
    {
        Added.Add(entity);
        if (entity is OperationalTask task && task.Id != Guid.Empty) Tasks[task.Id] = task;
    }

    public void Track(OperationalTask task) => Tasks[task.Id] = task;

    public void Audit(Guid actorId, string action, Guid taskId, DateTimeOffset now) { }
}

internal sealed class FakeEvidenceFiles : ITaskEvidenceFiles
{
    public List<string> Stored { get; } = [];
    public string Validate(byte[] content, int maximumBytes) => "image/jpeg";
    public Task PutAsync(Guid taskId, string key, byte[] content, string contentType, CancellationToken t) { Stored.Add(key); return Task.CompletedTask; }
    public Task CopyAsync(string key, Stream output, CancellationToken t) => Task.CompletedTask;
}
