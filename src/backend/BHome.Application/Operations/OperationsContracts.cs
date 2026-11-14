using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.Operations;

public sealed class OperationsException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static OperationsException Invalid(string code) => new(400, code);
    public static OperationsException Missing() => new(404, "operations_resource_not_found");
    public static OperationsException Forbidden() => new(403, "operations_forbidden");
    public static OperationsException Conflict(string code) => new(409, code);
}

public sealed record OperationsPage<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public sealed record ProfileView(Guid UserId, string FullName, string? Phone, string? Email,
    IReadOnlyList<string> Roles, bool IsActive, string Version);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ProfileUpdate(
    [Required, StringLength(150, MinimumLength = 2)] string FullName,
    [StringLength(30)] string? Phone,
    [Required, EmailAddress, StringLength(256)] string Email,
    [Required, StringLength(256)] string Version,
    [StringLength(1024)] string? CurrentPassword = null);

public sealed record EmploymentView(Guid Id, string? ContractNumber, string EmploymentType,
    DateOnly StartDate, DateOnly? EndDate, string? SalaryType, decimal? BaseRate, string Status);

public sealed record StaffView(Guid UserId, string FullName, string? Phone, string Email, bool IsActive,
    string AccountVersion, EmploymentView? Employment);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record EmploymentWrite(
    [StringLength(100)] string? ContractNumber,
    [Required, StringLength(30)] string EmploymentType,
    DateOnly StartDate,
    DateOnly? EndDate,
    [StringLength(20)] string? SalaryType,
    [Range(typeof(decimal), "0", "999999999999999999")] decimal? BaseRate,
    [Required, RegularExpression("Active|Ended")] string Status);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record StaffCreate(
    [Required, EmailAddress, StringLength(256)] string Email,
    [Required, StringLength(150, MinimumLength = 2)] string FullName,
    [StringLength(30)] string? Phone,
    [StringLength(256)] string? InitialPassword,
    EmploymentWrite Employment);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record StaffUpdate(
    [Required, StringLength(256)] string AccountVersion,
    [Required, EmailAddress, StringLength(256)] string Email,
    [Required, StringLength(150, MinimumLength = 2)] string FullName,
    [StringLength(30)] string? Phone,
    bool IsActive,
    EmploymentWrite Employment,
    [Required, StringLength(500)] string Reason);

public sealed class StaffQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    [StringLength(200)] public string? Search { get; set; }
    public bool? IsActive { get; set; }
}

public sealed record ResidenceTaskView(Guid ContractId, Guid ResidentId, Guid LocationId, Guid RoomId,
    string RoomNumber, string ResidentLabel, string ResidentRole, Guid? TenantUserId,
    DateOnly ResidenceFrom, DateOnly? ActualResidenceFrom, string Status, bool HasEvidence,
    DateTimeOffset? ResultAt, bool OwnerConfirmed, DateTimeOffset? OwnerConfirmedAt,
    IReadOnlyList<ResidenceHistoryView> History);

public sealed record ResidenceHistoryView(string Action, Guid ActorId, DateTimeOffset OccurredAt, string? Note);

public sealed class ResidenceQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public string? Status { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ResidenceUpdate(
    DateOnly ActualResidenceFrom,
    [Required, RegularExpression("Pending|InProgress|Completed")] string Status,
    DateTimeOffset? ResultAt,
    [StringLength(1000)] string? Note);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ResidenceOwnerConfirmation([Required, StringLength(1000)] string Note);

public sealed record OccupantSummary(Guid ResidentId, string DisplayLabel, string Role);
public sealed record RoomOccupancyView(Guid RoomId, Guid LocationId, string RoomNumber, string RoomStatus,
    Guid? ContractId, DateOnly? OccupancyFrom, DateOnly? OccupancyTo, IReadOnlyList<OccupantSummary> Occupants);
public sealed record RoomOccupancyPeriod(Guid ContractId, DateOnly From, DateOnly To, DateOnly? ActualEndDate,
    string ContractStatus, IReadOnlyList<OccupantSummary> Occupants);
public sealed record RoomOccupancyHistory(Guid RoomId, Guid LocationId, string RoomNumber,
    IReadOnlyList<RoomOccupancyPeriod> Periods);

public sealed class OccupancyQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public string? RoomStatus { get; set; }
}

public sealed record PublicPhotoView(int Index, string ContentType, long Length, string Url);
public sealed record LocationPublicContent(Guid LocationId, string Name, string Address, string Summary,
    IReadOnlyList<string> Amenities, string? ContactPhone, string? ContactEmail,
    IReadOnlyList<PublicPhotoView> Photos, bool Published, DateTimeOffset? PublishedAt);
public sealed record RoomPublicContent(Guid RoomId, Guid LocationId, string RoomNumber, string? Floor,
    int Capacity, string Description, IReadOnlyList<string> Amenities, decimal? IndicativePrice,
    string Vacancy, IReadOnlyList<PublicPhotoView> Photos, bool Published, DateTimeOffset? PublishedAt);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationPublicContentWrite(
    [StringLength(2000)] string Summary,
    [MaxLength(50)] string[] Amenities,
    [Phone, StringLength(30)] string? ContactPhone,
    [EmailAddress, StringLength(256)] string? ContactEmail);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RoomPublicContentWrite(
    [StringLength(2000)] string Description,
    [MaxLength(50)] string[] Amenities,
    [Range(typeof(decimal), "0", "999999999999999999")] decimal? IndicativePrice);

public sealed record RecurringTaskTemplateView(Guid Id, Guid LocationId, string Title, string Requirements,
    string Priority, bool EvidenceRequired, int IntervalDays, DateTimeOffset NextRunAt,
    int DueAfterHours, bool IsActive, int Version, string ScheduleType = "IntervalDays",
    int? DayOfWeek = null, int? DayOfMonth = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RecurringTaskTemplateWrite(
    Guid LocationId,
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    [Required, StringLength(8000, MinimumLength = 1)] string Requirements,
    [Required, RegularExpression("Normal|High")] string Priority,
    bool EvidenceRequired,
    [Range(1, 365)] int IntervalDays,
    DateTimeOffset NextRunAt,
    [Range(1, 720)] int DueAfterHours,
    bool IsActive,
    int Version = 0,
    [RegularExpression("IntervalDays|Daily|Weekly|Monthly")] string ScheduleType = "IntervalDays",
    [Range(1, 7)] int? DayOfWeek = null,
    [Range(1, 31)] int? DayOfMonth = null);

public sealed record OperationsFile(string ObjectKey, string ContentType, long Length);

public interface IOperationsRepository
{
    Task<ProfileView?> ProfileAsync(Guid userId, CancellationToken t);
    Task<ProfileView> UpdateProfileAsync(Guid userId, ProfileUpdate input, DateTimeOffset now, CancellationToken t);
    Task<OperationsPage<StaffView>> StaffAsync(StaffQuery query, CancellationToken t);
    Task<StaffView?> StaffAsync(Guid userId, CancellationToken t);
    Task<StaffView> CreateStaffAsync(Guid actorId, StaffCreate input, DateTimeOffset now, CancellationToken t);
    Task<StaffView> UpdateStaffAsync(Guid actorId, Guid userId, StaffUpdate input, DateTimeOffset now, CancellationToken t);
    Task<OperationsPage<ResidenceTaskView>> ResidenceAsync(ResidenceQuery query, Guid? tenantUserId, CancellationToken t);
    Task<ResidenceTaskView?> ResidenceAsync(Guid contractId, Guid residentId, Guid? tenantUserId, CancellationToken t);
    Task<ResidenceTaskView> UpdateResidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        ResidenceUpdate input, DateTimeOffset now, CancellationToken t);
    Task<ResidenceTaskView> ConfirmResidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        ResidenceOwnerConfirmation input, DateTimeOffset now, CancellationToken t);
    Task<ResidenceTaskView> AttachResidenceEvidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        OperationsFile file, DateTimeOffset now, CancellationToken t);
    Task<OperationsFile?> ResidenceEvidenceAsync(Guid contractId, Guid residentId, Guid? tenantUserId, CancellationToken t);
    Task<OperationsPage<RoomOccupancyView>> OccupancyAsync(OccupancyQuery query, Guid? staffUserId,
        DateOnly today, CancellationToken t);
    Task<RoomOccupancyHistory?> OccupancyHistoryAsync(Guid roomId, Guid? staffUserId, DateOnly today, CancellationToken t);
    Task<LocationPublicContent?> LocationContentAsync(Guid locationId, bool publishedOnly, CancellationToken t);
    Task<RoomPublicContent?> RoomContentAsync(Guid roomId, bool publishedOnly, CancellationToken t);
    Task<IReadOnlyList<LocationPublicContent>> PublishedLocationsAsync(CancellationToken t);
    Task<IReadOnlyList<RoomPublicContent>> PublishedRoomsAsync(Guid locationId, CancellationToken t);
    Task<LocationPublicContent> UpdateLocationContentAsync(Guid actorId, Guid locationId,
        LocationPublicContentWrite input, DateTimeOffset now, CancellationToken t);
    Task<RoomPublicContent> UpdateRoomContentAsync(Guid actorId, Guid roomId,
        RoomPublicContentWrite input, DateTimeOffset now, CancellationToken t);
    Task<LocationPublicContent> PublishLocationAsync(Guid actorId, Guid locationId, bool publish,
        DateTimeOffset now, CancellationToken t);
    Task<RoomPublicContent> PublishRoomAsync(Guid actorId, Guid roomId, bool publish,
        DateTimeOffset now, CancellationToken t);
    Task<LocationPublicContent> AttachLocationPhotoAsync(Guid actorId, Guid locationId,
        OperationsFile file, DateTimeOffset now, CancellationToken t);
    Task<RoomPublicContent> AttachRoomPhotoAsync(Guid actorId, Guid roomId,
        OperationsFile file, DateTimeOffset now, CancellationToken t);
    Task<OperationsFile?> RemoveLocationPhotoAsync(Guid actorId, Guid locationId, int index, DateTimeOffset now, CancellationToken t);
    Task<OperationsFile?> RemoveRoomPhotoAsync(Guid actorId, Guid roomId, int index, DateTimeOffset now, CancellationToken t);
    Task<OperationsFile?> PublicPhotoAsync(string targetType, Guid id, int index, bool publishedOnly, CancellationToken t);
    Task<IReadOnlyList<RecurringTaskTemplateView>> TemplatesAsync(Guid locationId, CancellationToken t);
    Task<RecurringTaskTemplateView> SaveTemplateAsync(Guid actorId, Guid? id, RecurringTaskTemplateWrite input,
        DateTimeOffset now, CancellationToken t);
    Task RemoveTemplateAsync(Guid actorId, Guid locationId, Guid id, int version, DateTimeOffset now, CancellationToken t);
    Task<int> GenerateDueRecurringTasksAsync(DateTimeOffset now, CancellationToken t);
}

public interface IOperationsFiles
{
    string ValidateImage(byte[] content);
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken t);
    Task CopyAsync(string key, Stream output, CancellationToken t);
    Task DeleteAsync(string key, CancellationToken t);
}
