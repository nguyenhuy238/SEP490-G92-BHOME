using BHome.Domain.Common;

namespace BHome.Domain.IncidentMaintenance;

// SRS UC-28 steps 6-12, UC-29, UC-30. Lifecycle:
// Assigned -> Pending Approval -> In Progress -> Pending Verification -> Verified, plus Cancelled.
// D4 (pending team decision): an approved plan stays Pending Approval with CostApprovedAt set until
// the assigned Staff starts the work (UC-29 steps 12-13).
public sealed class MaintenanceWorkOrder : AuditableEntity
{
    // Not readonly: EF materializes these JSONB columns into the fields.
    private List<EvidenceRef> evidence = [];
    private List<WorkOrderEntry> history = [];

    private MaintenanceWorkOrder() { }

    private MaintenanceWorkOrder(IncidentReport incident, Guid staffUserId, string description, string? expectedOutcome,
        DateTimeOffset? dueAt)
    {
        IncidentReportId = incident.Id;
        LocationId = incident.LocationId;
        RoomId = incident.RoomId;
        AssetId = incident.AssetId;
        AssignedStaffUserId = staffUserId;
        WorkDescription = description;
        ExpectedOutcome = expectedOutcome;
        DueAt = dueAt;
    }

    public Guid IncidentReportId { get; private set; }
    public Guid LocationId { get; private set; }
    public Guid? RoomId { get; private set; }
    public Guid? AssetId { get; private set; }
    public Guid AssignedStaffUserId { get; private set; }
    public string WorkDescription { get; private set; } = "";
    public string? ExpectedOutcome { get; private set; }
    public DateTimeOffset? DueAt { get; private set; }
    public WorkOrderStatus Status { get; private set; } = WorkOrderStatus.Assigned;
    public string? InspectionResult { get; private set; }
    public string? ProposedPlan { get; private set; }
    public string? EstimatedDuration { get; private set; }
    public decimal? EstimatedCost { get; private set; }
    public Guid? CostApprovedByUserId { get; private set; }
    public DateTimeOffset? CostApprovedAt { get; private set; }
    public string? PlanRejectionReason { get; private set; }
    public DateTimeOffset? StartedAt { get; private set; }
    public string? ResultSummary { get; private set; }
    public DateTimeOffset? SubmittedAt { get; private set; }
    public decimal? ActualCost { get; private set; }
    public string? CostVarianceReason { get; private set; }
    public Guid? VerifiedByUserId { get; private set; }
    public DateTimeOffset? VerifiedAt { get; private set; }
    public string? ReworkReason { get; private set; }
    public Guid? CancelledByUserId { get; private set; }
    public string? CancelReason { get; private set; }
    public IReadOnlyList<EvidenceRef> Evidence => evidence;
    public IReadOnlyList<WorkOrderEntry> History => history;
    public uint RowVersion { get; private set; }

    public bool IsOpen => Status is not (WorkOrderStatus.Verified or WorkOrderStatus.Cancelled);
    public bool IsPlanApproved => CostApprovedAt is not null;

    // UC-28 steps 6-12. The application verifies the Staff is assigned to the report's Location.
    public static MaintenanceWorkOrder Create(IncidentReport incident, Guid ownerUserId, Guid staffUserId,
        string workDescription, string? expectedOutcome, DateTimeOffset? dueAt, DateTimeOffset now)
    {
        if (staffUserId == Guid.Empty) throw new MaintenanceValidationException("staff_required");
        if (dueAt is { } due && due <= now) throw new MaintenanceValidationException("due_at_in_past");
        incident.StartHandling(ownerUserId, now);
        var order = new MaintenanceWorkOrder(incident, staffUserId, Rules.Text(workDescription, 2000, "work_description_required"),
            Rules.OptionalText(expectedOutcome, 1000, "expected_outcome_too_long"), dueAt);
        order.Record(WorkOrderEntryType.Created, ownerUserId, now, null, WorkOrderStatus.Assigned, null, staffUserId);
        return order;
    }

    // UC-29 steps 1-8 (and resubmission after A1 rejection).
    public void SubmitProposal(Guid staffUserId, string inspectionResult, string proposedPlan, string estimatedDuration,
        decimal? estimatedCost, IReadOnlyList<EvidenceRef>? beforeEvidence, DateTimeOffset now)
    {
        EnsureAssignee(staffUserId);
        Expect(WorkOrderStatus.Assigned);
        InspectionResult = Rules.Text(inspectionResult, 2000, "inspection_result_required");
        ProposedPlan = Rules.Text(proposedPlan, 2000, "proposed_plan_required");
        EstimatedDuration = Rules.Text(estimatedDuration, 50, "estimated_duration_required");
        EstimatedCost = Rules.Money(estimatedCost, "invalid_estimated_cost");
        AddEvidence(Rules.Evidence(beforeEvidence, EvidenceKind.Before, 0));
        PlanRejectionReason = null;
        Move(WorkOrderStatus.PendingApproval, WorkOrderEntryType.Proposal, staffUserId, now, null);
    }

    // UC-29 steps 9-11.
    public void ApprovePlan(Guid ownerUserId, DateTimeOffset now)
    {
        Expect(WorkOrderStatus.PendingApproval);
        if (IsPlanApproved) throw new MaintenanceStateException("plan_already_approved");
        CostApprovedByUserId = ownerUserId;
        CostApprovedAt = now;
        Record(WorkOrderEntryType.PlanApproved, ownerUserId, now, Status, Status, null);
    }

    // UC-29 A1: back to Assigned for a revised proposal.
    public void RejectPlan(Guid ownerUserId, string reason, DateTimeOffset now)
    {
        Expect(WorkOrderStatus.PendingApproval);
        var text = Rules.Text(reason, 1000, "reason_required");
        PlanRejectionReason = text;
        CostApprovedByUserId = null;
        CostApprovedAt = null;
        Move(WorkOrderStatus.Assigned, WorkOrderEntryType.PlanRejected, ownerUserId, now, text);
    }

    // UC-29 steps 12-13.
    public void Start(Guid staffUserId, DateTimeOffset now)
    {
        EnsureAssignee(staffUserId);
        Expect(WorkOrderStatus.PendingApproval);
        if (!IsPlanApproved) throw new MaintenanceStateException("plan_not_approved");
        StartedAt = now;
        Move(WorkOrderStatus.InProgress, WorkOrderEntryType.Started, staffUserId, now, null);
    }

    // UC-29 step 14-15.
    public void AddProgress(Guid staffUserId, string note, IReadOnlyList<EvidenceRef>? progressEvidence, DateTimeOffset now)
    {
        EnsureAssignee(staffUserId);
        Expect(WorkOrderStatus.InProgress);
        AddEvidence(Rules.Evidence(progressEvidence, EvidenceKind.Progress, 0));
        Record(WorkOrderEntryType.Progress, staffUserId, now, Status, Status, Rules.Text(note, 1000, "note_required"));
    }

    // UC-29 A2 (blocker), A4 (contractor needed), A5 (replacement/retirement proposal), A6 (late): history only.
    public void ReportBlocker(Guid staffUserId, string note, DateTimeOffset now)
    {
        EnsureAssignee(staffUserId);
        EnsureOpen();
        if (Status == WorkOrderStatus.PendingVerification) throw new MaintenanceStateException("awaiting_verification");
        Record(WorkOrderEntryType.Blocker, staffUserId, now, Status, Status, Rules.Text(note, 1000, "note_required"));
    }

    // UC-29 steps 16-20, A7: at least one after-repair photo is mandatory.
    public void SubmitForVerification(Guid staffUserId, string resultSummary, IReadOnlyList<EvidenceRef> afterEvidence,
        DateTimeOffset now)
    {
        EnsureAssignee(staffUserId);
        Expect(WorkOrderStatus.InProgress);
        var files = Rules.Evidence(afterEvidence, EvidenceKind.After, 1);
        ResultSummary = Rules.Text(resultSummary, 2000, "result_summary_required");
        AddEvidence(files);
        SubmittedAt = now;
        Move(WorkOrderStatus.PendingVerification, WorkOrderEntryType.Submitted, staffUserId, now, null);
    }

    // UC-30 steps 4-8, A4: a differing actual cost needs a reason.
    public void Verify(Guid ownerUserId, decimal actualCost, string? costVarianceReason, DateTimeOffset now)
    {
        Expect(WorkOrderStatus.PendingVerification);
        var cost = Rules.Money(actualCost, "invalid_actual_cost")!.Value;
        var reason = Rules.OptionalText(costVarianceReason, 1000, "reason_too_long");
        if (EstimatedCost is { } estimate && estimate != cost && reason is null)
            throw new MaintenanceValidationException("cost_variance_reason_required");
        ActualCost = cost;
        CostVarianceReason = reason;
        VerifiedByUserId = ownerUserId;
        VerifiedAt = now;
        Move(WorkOrderStatus.Verified, WorkOrderEntryType.Verified, ownerUserId, now, reason);
    }

    // UC-30 A1.
    public void RequestRework(Guid ownerUserId, string reason, DateTimeOffset now)
    {
        Expect(WorkOrderStatus.PendingVerification);
        var text = Rules.Text(reason, 1000, "reason_required");
        ReworkReason = text;
        Move(WorkOrderStatus.InProgress, WorkOrderEntryType.Rework, ownerUserId, now, text);
    }

    // UC-30 A3.
    public void Cancel(Guid ownerUserId, string reason, DateTimeOffset now)
    {
        EnsureOpen();
        var text = Rules.Text(reason, 1000, "reason_required");
        CancelledByUserId = ownerUserId;
        CancelReason = text;
        Move(WorkOrderStatus.Cancelled, WorkOrderEntryType.Cancelled, ownerUserId, now, text);
    }

    // UC-28 A6: status unchanged, history preserved. The application checks the new Staff's eligibility.
    public void Reassign(Guid ownerUserId, Guid newStaffUserId, string? reason, DateTimeOffset now)
    {
        EnsureOpen();
        if (Status == WorkOrderStatus.PendingVerification) throw new MaintenanceStateException("awaiting_verification");
        if (newStaffUserId == Guid.Empty) throw new MaintenanceValidationException("staff_required");
        if (newStaffUserId == AssignedStaffUserId) throw new MaintenanceValidationException("same_staff");
        AssignedStaffUserId = newStaffUserId;
        Record(WorkOrderEntryType.Reassigned, ownerUserId, now, Status, Status,
            Rules.OptionalText(reason, 1000, "reason_too_long"), newStaffUserId);
    }

    public bool ContainsEvidence(string key) => evidence.Any(e => e.Key == key);

    private void AddEvidence(IReadOnlyList<EvidenceRef> files)
    {
        if (evidence.Count + files.Count > 30) throw new MaintenanceValidationException("too_many_evidence_files");
        evidence.AddRange(files);
    }

    private void EnsureAssignee(Guid staffUserId)
    {
        if (staffUserId != AssignedStaffUserId) throw new MaintenanceStateException("not_assigned_staff");
    }

    private void EnsureOpen()
    {
        if (!IsOpen) throw new MaintenanceStateException("work_order_closed");
    }

    private void Expect(WorkOrderStatus status)
    {
        if (Status != status) throw new MaintenanceStateException("invalid_work_order_status");
    }

    private void Move(WorkOrderStatus to, WorkOrderEntryType type, Guid actorUserId, DateTimeOffset now, string? note)
    {
        var from = Status;
        Status = to;
        Record(type, actorUserId, now, from, to, note);
    }

    private void Record(WorkOrderEntryType type, Guid actorUserId, DateTimeOffset now, WorkOrderStatus? from,
        WorkOrderStatus? to, string? note, Guid? staffUserId = null) =>
        history.Add(new WorkOrderEntry(type, actorUserId, now, from, to, note, staffUserId));
}
