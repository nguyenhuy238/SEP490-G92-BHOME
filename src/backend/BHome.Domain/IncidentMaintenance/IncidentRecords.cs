using BHome.Domain.Common;

namespace BHome.Domain.IncidentMaintenance;

public enum IncidentSeverity { Normal, Emergency }
public enum IncidentStatus { Submitted, InProgress, Resolved, Rejected, Duplicate, Cancelled }
public enum WorkOrderStatus { Assigned, PendingApproval, InProgress, PendingVerification, Verified, Cancelled }
public enum IncidentEvidenceKind { Report, EmergencyAction, Inspection, Completion, Direct }

public sealed class IncidentReport : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string? CommonArea { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? ContractId { get; set; }
    public Guid ReporterId { get; set; }
    public string ReporterRole { get; set; } = "";
    public string Description { get; set; } = "";
    public IncidentSeverity Severity { get; set; }
    public IncidentStatus Status { get; set; }
    public string? Type { get; set; }
    public string? Category { get; set; }
    public Guid? DuplicateOfId { get; set; }
    public Guid? AcknowledgedById { get; set; }
    public DateTimeOffset? AcknowledgedAt { get; set; }
    public DateTimeOffset? OwnerDecisionAt { get; set; }
    public string? ResolutionNote { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public int Version { get; set; } = 1;
    public bool IsOpen => Status is IncidentStatus.Submitted or IncidentStatus.InProgress;

    public static bool CanResolve(IReadOnlyCollection<WorkOrderStatus> states) =>
        states.Count > 0 && states.Any(s => s == WorkOrderStatus.Verified) &&
        states.All(s => s is WorkOrderStatus.Verified or WorkOrderStatus.Cancelled);
}

public sealed class MaintenanceWorkOrder : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public Guid AssignedStaffId { get; set; }
    public string ExpectedOutcome { get; set; } = "";
    public DateTimeOffset TargetCompletionAt { get; set; }
    public WorkOrderStatus Status { get; set; }
    public string? InspectionResult { get; set; }
    public string? ProposedSolution { get; set; }
    public string? Vendor { get; set; }
    public int? EstimatedMinutes { get; set; }
    public decimal? EstimatedCost { get; set; }
    public int ProposalVersion { get; set; }
    public int? ApprovedProposalVersion { get; set; }
    public Guid? ApprovedById { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? Result { get; set; }
    public Guid? CompletionActivityId { get; set; }
    public decimal? ActualCost { get; set; }
    public Guid? VerifiedById { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public int Version { get; set; } = 1;
    public bool PlanApproved => ApprovedProposalVersion == ProposalVersion && ApprovedAt is not null;
    public bool IsOpen => Status is not (WorkOrderStatus.Verified or WorkOrderStatus.Cancelled);

    public void Propose()
    {
        Require(Status == WorkOrderStatus.Assigned || Status == WorkOrderStatus.PendingApproval);
        ProposalVersion++; ApprovedProposalVersion = null; ApprovedById = null; ApprovedAt = null;
        Status = WorkOrderStatus.PendingApproval;
    }
    public void DecidePlan(bool approve, Guid actor, DateTimeOffset now)
    {
        Require(Status == WorkOrderStatus.PendingApproval && !PlanApproved);
        if (!approve) { Status = WorkOrderStatus.Assigned; return; }
        ApprovedProposalVersion = ProposalVersion; ApprovedById = actor; ApprovedAt = now;
    }
    public void Start()
    {
        Require(Status == WorkOrderStatus.PendingApproval && PlanApproved);
        Status = WorkOrderStatus.InProgress;
    }
    public void Submit(Guid activity)
    {
        Require(Status == WorkOrderStatus.InProgress && PlanApproved);
        CompletionActivityId = activity; Status = WorkOrderStatus.PendingVerification;
    }
    public void Verify(Guid actor, DateTimeOffset now)
    {
        Require(Status == WorkOrderStatus.PendingVerification && CompletionActivityId is not null);
        Status = WorkOrderStatus.Verified; VerifiedById = actor; VerifiedAt = now;
    }
    public void Rework()
    {
        Require(Status == WorkOrderStatus.PendingVerification);
        Status = WorkOrderStatus.InProgress; CompletionActivityId = null;
    }
    public void Cancel()
    {
        Require(IsOpen); Status = WorkOrderStatus.Cancelled;
    }
    private static void Require(bool condition)
    { if (!condition) throw new InvalidOperationException("invalid_work_order_transition"); }
}

// Immutable event payload retains proposal/decision/assignment snapshots; public notes are separate.
public sealed class IncidentActivity : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid ActorId { get; set; }
    public string Action { get; set; } = "";
    public string Note { get; set; } = "";
    public bool TenantVisible { get; set; }
    public string DataJson { get; set; } = "{}";
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class IncidentEvidence : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid? ActivityId { get; set; }
    public Guid UploadedById { get; set; }
    public IncidentEvidenceKind Kind { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public long Length { get; set; }
}

public sealed class EmergencyAction : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid ActivityId { get; set; }
    public Guid ActorId { get; set; }
    public decimal? RequestedCost { get; set; }
    public bool? CostApproved { get; set; }
    public Guid? CostDecidedById { get; set; }
    public DateTimeOffset? CostDecidedAt { get; set; }
}

// SourceId is a WorkOrder ID, direct-completion Activity ID or EmergencyAction ID, never an aggregate total.
public sealed class MaintenanceExpense : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid? EmergencyActionId { get; set; }
    public string Category { get; set; } = "Maintenance";
    public string SourceType { get; set; } = "";
    public Guid SourceId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly ExpenseDate { get; set; }
    public Guid ConfirmedById { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }
}

public sealed class MaintenanceHistory : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid ActivityId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public string? ConditionBefore { get; set; }
    public string? ConditionAfter { get; set; }
    public string? StatusBefore { get; set; }
    public string? StatusAfter { get; set; }
    public decimal ActualCost { get; set; }
    public Guid VerifiedById { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
}

public sealed class IncidentCommand : AuditableEntity
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public Guid IncidentId { get; set; }
    public string Fingerprint { get; set; } = "";
    public string ResponseJson { get; set; } = "";
}

public sealed class IncidentNotification : AuditableEntity
{
    public Guid IncidentId { get; set; }
    public Guid ActivityId { get; set; }
    public Guid RecipientId { get; set; }
    public string Event { get; set; } = "";
    public bool HighPriority { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public string DeliveryState { get; set; } = "Pending";
    public string? DeliveryReference { get; set; }
    public string? DeliveryError { get; set; }
}

// No business FK: submission may roll back or never finish; cleanup still owns this object key.
public sealed class IncidentFileUpload : AuditableEntity
{
    public Guid LocationId { get; set; }
    public string ObjectKey { get; set; } = "";
    public DateTimeOffset CleanupAfter { get; set; }
}
