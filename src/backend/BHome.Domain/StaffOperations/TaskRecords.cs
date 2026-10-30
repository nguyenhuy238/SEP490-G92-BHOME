using BHome.Domain.Common;

namespace BHome.Domain.StaffOperations;

public enum OperationalTaskKind { MeterReading, AdHoc }
public enum OperationalTaskPriority { Normal, High }

public sealed class OperationalTaskHistory : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid ActorId { get; set; }
    public string Action { get; set; } = "";
    public string Note { get; set; } = "";
    public string ChangesJson { get; set; } = "{}";
    public Guid? ResponsibleStaffUserId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public bool WasOverdue { get; set; }
    public int TaskVersion { get; set; }
}

public sealed class OperationalTaskEvidence : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public long Length { get; set; }
    // Submission number lets rework require a new, explicit selection without deleting old evidence.
    public Guid? SubmissionId { get; set; }
}

public sealed class OperationalTaskCommand : AuditableEntity
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public Guid TaskId { get; set; }
    public string Fingerprint { get; set; } = "";
    public string ResponseJson { get; set; } = "";
}

public sealed class OperationalTaskNotification : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid RecipientUserId { get; set; }
    public Guid EventId { get; set; }
    public string Event { get; set; } = "";
    public DateTimeOffset? ReadAt { get; set; }
}

// Durable staging lease, independent from a rolled-back business transaction.
public sealed class OperationalTaskFileUpload : AuditableEntity
{
    public Guid TaskId { get; set; }
    public string ObjectKey { get; set; } = "";
    public DateTimeOffset CleanupAfter { get; set; }
}
