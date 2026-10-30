using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;

namespace BHome.Domain.Billing;

public enum UtilityType { Electricity, Water }
public enum MeterDisplay { Mechanical, Digital }
public enum ReadingPurpose { Initial, Periodic, Final }
// Preserve the legacy numeric values used by meter APIs and filtered indexes.
public enum MeterTaskStatus { Assigned, InProgress, Completed, Cancelled, PendingVerification }
public enum MeterReadingStatus { Confirmed, Corrected }

public sealed class Meter : AuditableEntity
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public string Code { get; set; } = "";
    public UtilityType UtilityType { get; set; }
    public MeterDisplay Display { get; set; }
    public int DecimalPlaces { get; set; }
    public bool IsActive { get; set; } = true;
    public DateOnly InstalledOn { get; set; }
}
public sealed class OperationalTask : AuditableEntity
{
    public OperationalTaskKind Kind { get; set; }
    public Guid LocationId { get; set; }
    public BHome.Domain.Locations.Location Location { get; set; } = null!;
    public string Title { get; set; } = "";
    public string Requirements { get; set; } = "";
    public OperationalTaskPriority Priority { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public bool EvidenceRequired { get; set; }
    public Guid? AssignedStaffUserId { get; set; }
    public Guid? AssignmentId { get; set; }
    public DateTimeOffset? AssignedAt { get; set; }
    public string? Result { get; set; }
    public Guid? VerifiedByUserId { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public int Version { get; set; } = 1;
    // Meter details remain in the existing table to preserve reading/evidence FKs and API IDs.
    // Kind and database constraints distinguish these from Owner-verified operational work.
    public Guid? ContractId { get; set; }
    public Guid? MeterId { get; set; }
    public Meter Meter { get; set; } = null!;
    public ReadingPurpose Purpose { get; set; }
    public DateOnly ReadingDate { get; set; }
    public DateOnly? BillingPeriod { get; set; }
    public MeterTaskStatus Status { get; set; }
    public decimal? OcrProposedValue { get; set; }
    public string? OcrImageHash { get; set; }
    public string? OcrEngineVersion { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }

    public bool IsOverdue(DateTimeOffset now) => DueAt < now && Status is not (MeterTaskStatus.Completed or MeterTaskStatus.Cancelled);

    public void ApplyAction(string action, DateTimeOffset now, Guid actor)
    {
        if (Kind != OperationalTaskKind.AdHoc) throw new InvalidOperationException("meter_workflow_required");
        Status = (action, Status) switch
        {
            ("start", MeterTaskStatus.Assigned) => MeterTaskStatus.InProgress,
            ("progress" or "blockers", MeterTaskStatus.InProgress) => MeterTaskStatus.InProgress,
            ("coordinate", MeterTaskStatus.Assigned or MeterTaskStatus.InProgress or MeterTaskStatus.PendingVerification) => Status,
            ("submit", MeterTaskStatus.InProgress) => MeterTaskStatus.PendingVerification,
            ("verify", MeterTaskStatus.PendingVerification) => MeterTaskStatus.Completed,
            ("rework", MeterTaskStatus.PendingVerification) => MeterTaskStatus.InProgress,
            ("cancel", MeterTaskStatus.Assigned or MeterTaskStatus.InProgress or MeterTaskStatus.PendingVerification) => MeterTaskStatus.Cancelled,
            _ => throw new InvalidOperationException("invalid_task_transition")
        };
        if (action == "verify") { VerifiedByUserId = actor; VerifiedAt = now; CompletedAt = now; }
    }
}
public sealed class MeterEvidence : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ImageHash { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Length { get; set; }
    public DateTimeOffset CleanupAfter { get; set; }
    public bool IsUploaded { get; set; }
    public bool IsLinked { get; set; }
}
public sealed class MeterReading : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid MeterId { get; set; }
    public Guid EvidenceId { get; set; }
    public decimal? PreviousValue { get; set; }
    public decimal? OcrProposedValue { get; set; }
    public decimal ConfirmedValue { get; set; }
    public decimal? Consumption { get; set; }
    public MeterReadingStatus Status { get; set; }
    public Guid ConfirmedByUserId { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }
}
