using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

public enum UtilityType { Electricity, Water }
public enum MeterDisplay { Mechanical, Digital }
public enum ReadingPurpose { Initial, Periodic }
public enum MeterTaskStatus { Assigned, InProgress, Completed, Cancelled }
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
    public Guid MeterId { get; set; }
    public Meter Meter { get; set; } = null!;
    public Guid AssignedStaffUserId { get; set; }
    public ReadingPurpose Purpose { get; set; }
    public DateOnly ReadingDate { get; set; }
    public DateOnly? BillingPeriod { get; set; }
    public MeterTaskStatus Status { get; set; }
    public decimal? OcrProposedValue { get; set; }
    public string? OcrImageHash { get; set; }
    public string? OcrEngineVersion { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
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
