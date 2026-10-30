using System.ComponentModel.DataAnnotations;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance.Contracts;

// Raw upload handed from the HTTP layer. Content is validated (size + JPEG/PNG/WebP signature) by the service.
public sealed record EvidenceUpload(Stream Content, long Length);

// ---- Inputs (DataAnnotations are re-validated by the service) ----
public sealed record SubmitIncidentInput(Guid? LocationId, Guid? RoomId, Guid? AssetId, IncidentSeverity Severity,
    [Required, StringLength(200)] string Summary, [Required, StringLength(2000, MinimumLength = 10)] string Description);
public sealed record ReasonInput([Required, StringLength(1000)] string Reason);
public sealed record OptionalReasonInput([StringLength(1000)] string? Reason);
public sealed record DuplicateInput(Guid OriginalReportId, [StringLength(1000)] string? Reason);
public sealed record ClassifyInput([StringLength(50)] string? OfficialCategory);
public sealed record ResolveInput([Required, StringLength(2000)] string ResolutionNote);
public sealed record HandleDirectlyInput([Required, StringLength(2000)] string ResolutionNote, [Range(0, 999_999_999_999)] decimal ActualCost);
public sealed record ImmediateActionInput([Required, StringLength(1000)] string Note, [Range(0, 999_999_999_999)] decimal? Amount);
public sealed record CreateWorkOrderInput(Guid StaffUserId, [Required, StringLength(2000)] string WorkDescription,
    [StringLength(1000)] string? ExpectedOutcome, DateTimeOffset? DueAt, [StringLength(50)] string? OfficialCategory);
public sealed record ReassignInput(Guid StaffUserId, [StringLength(1000)] string? Reason);
public sealed record ProposalInput([Required, StringLength(2000)] string InspectionResult, [Required, StringLength(2000)] string ProposedPlan,
    [Required, StringLength(50)] string EstimatedDuration, [Range(0, 999_999_999_999)] decimal? EstimatedCost);
public sealed record NoteInput([Required, StringLength(1000)] string Note);
public sealed record SubmitResultInput([Required, StringLength(2000)] string ResultSummary);
public sealed record VerifyInput([Range(0, 999_999_999_999)] decimal ActualCost, [StringLength(1000)] string? CostVarianceReason);
public sealed record AssetConditionInput([Required, StringLength(1000)] string Condition);

// ---- Queries ----
public sealed record IncidentListQuery(Guid? LocationId = null, IncidentStatus? Status = null,
    IncidentSeverity? Severity = null, bool OpenOnly = false, int Take = 50);
public sealed record WorkOrderListQuery(bool Mine = false, Guid? LocationId = null, WorkOrderStatus? Status = null, int Take = 50);
public sealed record MaintenanceHistoryQuery(Guid? LocationId = null, Guid? RoomId = null, Guid? AssetId = null, int Take = 100);

// ---- Outputs (least-privilege projections, never EF entities) ----
public sealed record EmergencyContact(string Number, string Purpose);
public sealed record EvidenceItem(string FileId, EvidenceKind Kind, DateTimeOffset At, string ContentType, long Length);
public sealed record IncidentActionItem(IncidentActionType Type, Guid ActorUserId, DateTimeOffset At, string? Note,
    decimal? Amount, IReadOnlyList<string> FileIds);
public sealed record WorkOrderEntryItem(WorkOrderEntryType Type, Guid ActorUserId, DateTimeOffset At,
    WorkOrderStatus? FromStatus, WorkOrderStatus? ToStatus, string? Note, Guid? StaffUserId);

public sealed record IncidentSummary(Guid Id, string ReportCode, Guid LocationId, Guid? RoomId, Guid? AssetId,
    IncidentSeverity Severity, IncidentStatus Status, string Summary, DateTimeOffset SubmittedAt,
    DateTimeOffset? AcknowledgedAt, bool AcknowledgementOverdue);

public sealed record IncidentDetail(Guid Id, string ReportCode, Guid ReporterUserId, IncidentReporterRole ReporterRole,
    Guid LocationId, Guid? RoomId, Guid? AssetId, IncidentSeverity Severity, IncidentStatus Status, string Summary,
    string Description, DateTimeOffset SubmittedAt, IReadOnlyList<EvidenceItem> Evidence,
    Guid? AcknowledgedByUserId, DateTimeOffset? AcknowledgedAt, DateTimeOffset? AckDueAt, DateTimeOffset? EscalatedAt,
    IReadOnlyList<IncidentActionItem> ImmediateActions, IncidentDecision? OwnerDecision, DateTimeOffset? OwnerDecidedAt,
    string? OwnerDecisionReason, Guid? DuplicateOfReportId, string? OfficialCategory, string? ResolutionNote,
    string? CancelReason, DateTimeOffset? ClosedAt, IReadOnlyList<WorkOrderSummary> WorkOrders);

public sealed record WorkOrderSummary(Guid Id, Guid IncidentReportId, string ReportCode, Guid LocationId, Guid? RoomId,
    Guid? AssetId, Guid AssignedStaffUserId, WorkOrderStatus Status, bool PlanApproved, DateTimeOffset? DueAt,
    DateTimeOffset CreatedAt);

public sealed record WorkOrderDetail(Guid Id, Guid IncidentReportId, string ReportCode, string IncidentSummary,
    string IncidentDescription, IncidentSeverity Severity, Guid LocationId, Guid? RoomId, Guid? AssetId,
    Guid AssignedStaffUserId, WorkOrderStatus Status, string WorkDescription, string? ExpectedOutcome, DateTimeOffset? DueAt,
    string? InspectionResult, string? ProposedPlan, string? EstimatedDuration, decimal? EstimatedCost, bool PlanApproved,
    DateTimeOffset? CostApprovedAt, string? PlanRejectionReason, DateTimeOffset? StartedAt, string? ResultSummary,
    DateTimeOffset? SubmittedAt, decimal? ActualCost, string? CostVarianceReason, DateTimeOffset? VerifiedAt,
    string? ReworkReason, string? CancelReason, IReadOnlyList<EvidenceItem> Evidence, IReadOnlyList<WorkOrderEntryItem> History);

public sealed record AssetSummary(Guid Id, Guid LocationId, Guid? RoomId, string? CommonArea, string? Code, string Name,
    string Category, string Condition, AssetStatus Status, int Version);

// Screen 6.4.1 Maintenance History: one row per Work Order.
public sealed record MaintenanceHistoryItem(Guid WorkOrderId, Guid IncidentReportId, string ReportCode, string IncidentSummary,
    Guid LocationId, Guid? RoomId, Guid? AssetId, Guid AssignedStaffUserId, WorkOrderStatus Status, decimal? EstimatedCost,
    decimal? ActualCost, string? ResultSummary, int ReworkCount, DateTimeOffset CreatedAt, DateTimeOffset? VerifiedAt);

public sealed record IdResult(Guid Id);
public sealed record EvidenceFile(string ContentType, string ObjectKey);
