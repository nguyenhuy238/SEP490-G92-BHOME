using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Ocr;

public sealed record LocationInput([Required, StringLength(150)] string Name, [Required, StringLength(1000)] string Address);
public sealed record RoomInput(Guid LocationId, [Required, StringLength(50)] string RoomNumber,
    Guid? RoomTypeId = null, [Range(1, 32767)] int Capacity = 1);
public sealed record AssignmentInput(Guid LocationId, Guid StaffUserId, DateOnly EffectiveFrom, DateOnly? EffectiveTo);
public sealed record StaffInput([Required, StringLength(100)] string UserName, [Required, EmailAddress, StringLength(256)] string Email, [Required, StringLength(1024, MinimumLength = 12)] string Password)
{
    public override string ToString() => "Staff input (credentials omitted)";
}
public sealed record ResidentInput(Guid RoomId, [Required, StringLength(150)] string DisplayLabel, ResidentType ResidentType);
public sealed record MeterInput(Guid RoomId, [Required, StringLength(80)] string Code,
    UtilityType UtilityType, MeterDisplay Display, [Range(0, 4)] int DecimalPlaces, DateOnly InstalledOn);
public sealed record MeterTaskInput(Guid MeterId, ReadingPurpose Purpose, DateOnly ReadingDate, DateOnly? BillingPeriod, Guid? ContractId = null);
public sealed record IdentityConfirmation(
    bool HumanConfirmed, [Required, StringLength(12, MinimumLength = 12)] string CitizenIdentityNumber,
    [Required, StringLength(150)] string FullName, DateOnly DateOfBirth,
    [StringLength(1000)] string? ResidentialAddress, [StringLength(30)] string? Gender,
    [StringLength(100)] string? Nationality, [StringLength(1000)] string? PlaceOfOrigin,
    DateOnly? DateOfIssue, DateOnly? DateOfExpiry)
{
    public override string ToString() => "Identity confirmation (sensitive fields omitted)";
}
public sealed record MeterConfirmation(bool HumanConfirmed, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal ConfirmedValue, Guid EvidenceId);
public sealed record IdResult(Guid Id);
public sealed record NamedResource(Guid Id, string Label, Guid? ParentId = null);
public sealed record ResidentSummary(Guid Id, Guid RoomId, string DisplayLabel, ResidentType ResidentType,
    IdentityVerificationStatus VerificationStatus, DateTimeOffset? ConfirmedAt);
public sealed record IdentityConfirmationResult(Guid Id, IdentityVerificationStatus VerificationStatus, DateTimeOffset? ConfirmedAt);
public sealed record MeterTaskSummary(Guid Id, Guid MeterId, string Location, string Room, string MeterCode,
    UtilityType UtilityType, MeterDisplay Display, int DecimalPlaces, ReadingPurpose Purpose,
    DateOnly ReadingDate, DateOnly? BillingPeriod, MeterTaskStatus Status, [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PreviousValue,
    Guid? ContractId = null, Guid? ConfirmedReadingId = null);
public sealed record ConfirmedReading(Guid Id, Guid TaskId, [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal ConfirmedValue,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PreviousValue,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? Consumption, MeterReadingStatus Status, DateTimeOffset ConfirmedAt);

public sealed class CaptureConflictException(string code) : Exception("Dữ liệu không cho phép thao tác này.")
{
    public string Code { get; } = code;
}
public sealed class CaptureValidationException(string code) : Exception("Dữ liệu không hợp lệ.")
{
    public string Code { get; } = code;
}

public interface ICaptureRepository
{
    Task<IReadOnlyList<NamedResource>> ChainsAsync(CancellationToken token);
    Task<IReadOnlyList<NamedResource>> LocationsAsync(CancellationToken token);
    Task<IReadOnlyList<NamedResource>> RoomsAsync(Guid locationId, CancellationToken token);
    Task<IReadOnlyList<NamedResource>> StaffAsync(CancellationToken token);
    Task<IdResult> CreateStaffAsync(StaffInput input, CancellationToken token);
    Task<IdResult> AssignStaffAsync(AssignmentInput input, CancellationToken token);
    Task<IdResult> CreateResidentAsync(ResidentInput input, CancellationToken token);
    Task<IReadOnlyList<ResidentSummary>> ResidentsAsync(Guid locationId, CancellationToken token);
    Task<IdentityConfirmationResult> ConfirmIdentityAsync(Guid residentId, IdentityConfirmation input, CancellationToken token);
    Task<IdResult> CreateMeterAsync(MeterInput input, CancellationToken token);
    Task<IReadOnlyList<NamedResource>> MetersAsync(Guid locationId, CancellationToken token);
    Task<IdResult> CreateTaskAsync(MeterTaskInput input, CancellationToken token);
    Task<IReadOnlyList<MeterTaskSummary>> TasksAsync(CancellationToken token);
    Task<IdResult> UploadEvidenceAsync(Guid taskId, Stream input, CancellationToken token);
    Task<ConfirmedReading> ConfirmMeterAsync(Guid taskId, MeterConfirmation input, CancellationToken token);
    Task CopyEvidenceAsync(Guid readingId, Stream output, CancellationToken token);
}
