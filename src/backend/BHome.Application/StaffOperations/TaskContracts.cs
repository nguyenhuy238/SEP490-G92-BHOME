using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;

namespace BHome.Application.StaffOperations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskWrite(
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    [Required, StringLength(8000, MinimumLength = 1)] string Requirements,
    [property: JsonConverter(typeof(JsonStringEnumConverter<OperationalTaskPriority>))] OperationalTaskPriority Priority,
    [property: JsonConverter(typeof(TaskOffsetConverter))] DateTimeOffset DueAt,
    bool EvidenceRequired,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TaskTarget? Target = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskTarget(Guid? RoomId = null, Guid? AssetId = null, [StringLength(200)] string? CommonArea = null);
public sealed record TaskTargetView(Guid? RoomId, Guid? AssetId, string? CommonArea, string Label, Guid? ContractId = null);
public sealed record TaskTargetOption(Guid Id, string Name, Guid? RoomId, string? CommonArea);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskCreate(Guid LocationId, TaskWrite Work);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskUpdate(int Version, TaskWrite Work, [Required, StringLength(2000)] string Reason);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskAction(int Version, [StringLength(8000)] string? Note = null, [MaxLength(50)] Guid[]? EvidenceIds = null);
public sealed record TaskPage<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);
public sealed class TaskQuery
{
    [Range(1, 1000000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? StaffUserId { get; set; }
    public Guid? RecordedStaffUserId { get; set; }
    public bool? HasResponsibility { get; set; }
    public MeterTaskStatus? Status { get; set; }
    public OperationalTaskPriority? Priority { get; set; }
    public bool? IsOverdue { get; set; }
    public bool LatestActionable { get; set; }
    public DateTimeOffset? DueFrom { get; set; }
    public DateTimeOffset? DueTo { get; set; }
}
public sealed record TaskView(Guid Id, Guid LocationId, string Kind, string Title, string Requirements,
    string Priority, DateTimeOffset? DueAt, bool EvidenceRequired, string Status, bool IsOverdue,
    Guid? CurrentResponsibleStaffUserId, Guid? RecordedStaffUserId, bool ResponsibilityAvailable,
    string? Result, int Version, Guid? VerifiedByUserId, DateTimeOffset? VerifiedAt,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TaskTargetView? Target = null);
public sealed record TaskHistoryView(Guid Id, Guid ActorId, string Action, string Note, string ChangesJson,
    Guid? ResponsibleStaffUserId, DateTimeOffset OccurredAt, bool WasOverdue, int TaskVersion);
public sealed record TaskActorView(Guid UserId, string DisplayName);
public sealed record TaskEvidenceView(Guid Id, string ContentType, long Length, Guid UploadedByUserId,
    DateTimeOffset CreatedAt, Guid? SubmissionId);
public sealed record TaskNotificationView(Guid Id, Guid TaskId, string Event, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt);
public sealed record TaskResponsibility(Guid AssignmentId, Guid StaffUserId);
public sealed record TaskLocation(Guid Id, bool IsActive);
public sealed record TaskIncidentTarget(Guid Id, Guid LocationId, Guid? RoomId, Guid? AssetId,
    Guid ReporterId, bool IsValidReport);

public sealed class OperationalTaskException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static OperationalTaskException Invalid(string code) => new(400, code);
    public static OperationalTaskException Missing() => new(404, "task_resource_not_found");
    public static OperationalTaskException Conflict(string code) => new(409, code);
}

public sealed class TaskEvidenceLimits
{
    // Deployment resource limits, not an SRS retention or incident policy.
    public int MaximumFilesPerTask { get; set; } = 10;
    public int MaximumFileBytes { get; set; } = 5 * 1024 * 1024;
}
public interface ITaskEvidenceFiles
{
    string Validate(byte[] content, int maximumBytes);
    Task PutAsync(Guid taskId, string key, byte[] content, string contentType, CancellationToken t);
    Task CopyAsync(string key, Stream output, CancellationToken t);
}

public interface IOperationalTaskRepository
{
    Task<T> TransactionAsync<T>(Guid locationId, Guid actorId, Guid commandKey, Func<Task<T>> operation, CancellationToken t);
    Task<TaskLocation?> LocationAsync(Guid id, CancellationToken t);
    Task<string?> TargetRoomNameAsync(Guid locationId, Guid roomId, CancellationToken t);
    Task<TaskTargetOption?> TargetAssetAsync(Guid locationId, Guid assetId, CancellationToken t);
    Task<IReadOnlyList<string>> CommonAreasAsync(Guid locationId, CancellationToken t);
    Task<TaskPage<TaskTargetOption>> TargetAssetsAsync(Guid locationId, Guid? roomId, string? commonArea, string? search, int page, int pageSize, CancellationToken t);
    Task<OperationalTask?> FindAsync(Guid id, CancellationToken t);
    Task<MeterTaskStatus?> MoveInMainTaskStatusAsync(Guid contractId, CancellationToken t);
    Task<LocationAssetInventorySnapshot> OwnerConfirmedInventoryAsync(OperationalTask task, CancellationToken t);
    Task<IReadOnlyList<TaskIncidentTarget>> IncidentTargetsAsync(Guid[] incidentIds, CancellationToken t);
    Task<bool> IncidentsResolvedAsync(Guid[] incidentIds, CancellationToken t);
    Task NotifyMoveInInventoryCompletedAsync(OperationalTask task, Guid actor, CancellationToken t);
    Task<TaskResponsibility?> ResponsibilityAsync(Guid locationId, DateOnly date, CancellationToken t);
    Task<TaskResponsibility?> StaffAtLocationAsync(Guid locationId, Guid staffId, DateOnly date, CancellationToken t);
    Task<Guid?> MoveOutInspectionStaffAsync(Guid contractId, CancellationToken t);
    Task<Guid[]> EnsureMoveOutFinalMeterTasksAsync(OperationalTask inspectionTask, Guid staffId, DateOnly date, CancellationToken t);
    Task<TaskPage<TaskView>> ListAsync(TaskQuery query, Guid? staffId, DateOnly date, DateTimeOffset now, CancellationToken t);
    Task<TaskPage<TaskHistoryView>> HistoryAsync(Guid taskId, int page, int size, CancellationToken t);
    Task<IReadOnlyList<TaskActorView>> ActorsAsync(Guid taskId, CancellationToken t);
    Task<OperationalTaskCommand?> CommandAsync(Guid actorId, Guid key, CancellationToken t);
    Task<IReadOnlyList<OperationalTaskEvidence>> EvidenceAsync(Guid taskId, CancellationToken t);
    Task<IReadOnlyList<Guid>> OwnersAsync(CancellationToken t);
    Task<TaskPage<TaskNotificationView>> NotificationsAsync(Guid userId, Guid? staffId, DateOnly date, int page, int size, CancellationToken t);
    Task<OperationalTaskNotification?> NotificationAsync(Guid id, Guid recipient, CancellationToken t);
    Task FlushAsync(CancellationToken t);
    void Add(object entity);
    void Track(OperationalTask task);
    void Audit(Guid actorId, string action, Guid taskId, DateTimeOffset now);
}

public sealed class TaskOffsetConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetString();
        if (value is null || !System.Text.RegularExpressions.Regex.IsMatch(value, @"T.*(?:Z|[+-]\d{2}:\d{2})$") ||
            !DateTimeOffset.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var date)) throw new JsonException("An ISO-8601 timestamp with an explicit offset is required.");
        return date.ToUniversalTime();
    }
    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) => writer.WriteStringValue(value);
}
