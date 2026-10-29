using BHome.Domain.Common;

namespace BHome.Domain.IncidentMaintenance;

// SRS UC-26..UC-28, UC-30 step 9. Scope (Location/Room/Asset) is resolved by the application from
// server data before construction; the entity only enforces lifecycle and content rules.
public sealed class IncidentReport : AuditableEntity
{
    // Not readonly: EF materializes these JSONB columns into the fields.
    private List<EvidenceRef> evidence = [];
    private List<IncidentAction> immediateActions = [];

    private IncidentReport() { }

    private IncidentReport(string reportCode, Guid reporterUserId, IncidentReporterRole reporterRole, Guid locationId,
        Guid? roomId, Guid? assetId, IncidentSeverity severity, string summary, string description, DateTimeOffset now)
    {
        ReportCode = reportCode;
        ReporterUserId = reporterUserId;
        ReporterRole = reporterRole;
        LocationId = locationId;
        RoomId = roomId;
        AssetId = assetId;
        Severity = severity;
        Summary = summary;
        Description = description;
        SubmittedAt = now;
    }

    public string ReportCode { get; private set; } = "";
    public Guid ReporterUserId { get; private set; }
    public IncidentReporterRole ReporterRole { get; private set; }
    public Guid LocationId { get; private set; }
    public Guid? RoomId { get; private set; }
    public Guid? AssetId { get; private set; }
    public IncidentSeverity Severity { get; private set; }
    public IncidentStatus Status { get; private set; } = IncidentStatus.Submitted;
    public string Summary { get; private set; } = "";
    public string Description { get; private set; } = "";
    public DateTimeOffset SubmittedAt { get; private set; }
    public IReadOnlyList<EvidenceRef> Evidence => evidence;
    public Guid? DuplicateOfReportId { get; private set; }
    public Guid? AcknowledgedByUserId { get; private set; }
    public DateTimeOffset? AcknowledgedAt { get; private set; }
    public DateTimeOffset? AckDueAt { get; private set; }
    public DateTimeOffset? EscalatedAt { get; private set; }
    public IReadOnlyList<IncidentAction> ImmediateActions => immediateActions;
    public IncidentDecision? OwnerDecision { get; private set; }
    public Guid? OwnerDecidedByUserId { get; private set; }
    public DateTimeOffset? OwnerDecidedAt { get; private set; }
    public string? OwnerDecisionReason { get; private set; }
    public string? OfficialCategory { get; private set; }
    public string? ResolutionNote { get; private set; }
    public Guid? CancelledByUserId { get; private set; }
    public string? CancelReason { get; private set; }
    public DateTimeOffset? ClosedAt { get; private set; }
    public uint RowVersion { get; private set; }

    public bool IsEmergency => Severity == IncidentSeverity.OperationalEmergency;
    public bool IsClosed => Status is IncidentStatus.Resolved or IncidentStatus.Rejected or IncidentStatus.Duplicate
        or IncidentStatus.Cancelled;

    // UC-26 steps 5-10. ackDeadline is the configured overdue threshold (UC-27 A1, OQ-04).
    public static IncidentReport Submit(string reportCode, Guid reporterUserId, IncidentReporterRole reporterRole,
        Guid locationId, Guid? roomId, Guid? assetId, IncidentSeverity severity, string summary, string description,
        IReadOnlyList<EvidenceRef>? evidence, DateTimeOffset now, TimeSpan ackDeadline)
    {
        if (reporterUserId == Guid.Empty || locationId == Guid.Empty) throw new MaintenanceValidationException("scope_required");
        if (!Enum.IsDefined(severity) || !Enum.IsDefined(reporterRole)) throw new MaintenanceValidationException("invalid_severity");
        var report = new IncidentReport(Rules.Text(reportCode, 30, "report_code_required"), reporterUserId, reporterRole,
            locationId, roomId, assetId, severity, Rules.Text(summary, 200, "summary_required"),
            Rules.Text(description, 2000, "description_too_short", Rules.MinDescriptionLength), now);
        report.evidence.AddRange(Rules.Evidence(evidence, EvidenceKind.Report, 0));
        if (report.IsEmergency)
        {
            report.AckDueAt = now + ackDeadline;
            // UC-26 A7: Staff reporting an emergency discovered on site has acknowledged it.
            if (reporterRole == IncidentReporterRole.Staff) report.Acknowledge(reporterUserId, now);
        }
        return report;
    }

    // UC-26 A4: reporter cancels before the Owner has made a handling decision.
    public void CancelByReporter(Guid actorUserId, string? reason, DateTimeOffset now)
    {
        if (actorUserId != ReporterUserId) throw new MaintenanceStateException("not_reporter");
        if (Status != IncidentStatus.Submitted || OwnerDecision is not null) throw new MaintenanceStateException("owner_already_decided");
        Close(IncidentStatus.Cancelled, now);
        CancelledByUserId = actorUserId;
        CancelReason = Rules.OptionalText(reason, 1000, "reason_too_long");
    }

    // UC-26 A5. The application first verifies no Work Order is still open.
    public void CancelByOwner(Guid ownerUserId, string reason, bool hasOpenWorkOrders, DateTimeOffset now)
    {
        if (Status is not (IncidentStatus.Submitted or IncidentStatus.InProgress)) throw new MaintenanceStateException("incident_closed");
        if (hasOpenWorkOrders) throw new MaintenanceStateException("open_work_orders");
        var text = Rules.Text(reason, 1000, "reason_required");
        Decide(IncidentDecision.Cancelled, ownerUserId, text, now);
        Close(IncidentStatus.Cancelled, now);
        CancelledByUserId = ownerUserId;
        CancelReason = text;
    }

    // UC-28 A1.
    public void Reject(Guid ownerUserId, string reason, DateTimeOffset now)
    {
        EnsureSubmitted();
        Decide(IncidentDecision.Rejected, ownerUserId, Rules.Text(reason, 1000, "reason_required"), now);
        Close(IncidentStatus.Rejected, now);
    }

    // UC-28 A2. The application verifies the original is open and in the same Location.
    public void MarkDuplicate(Guid ownerUserId, IncidentReport original, string? reason, DateTimeOffset now)
    {
        EnsureSubmitted();
        if (original.Id == Id) throw new MaintenanceValidationException("duplicate_of_self");
        if (original.LocationId != LocationId) throw new MaintenanceValidationException("duplicate_other_location");
        if (original.Status is IncidentStatus.Duplicate or IncidentStatus.Rejected or IncidentStatus.Cancelled)
            throw new MaintenanceStateException("original_not_valid");
        Decide(IncidentDecision.Duplicate, ownerUserId,
            Rules.OptionalText(reason, 1000, "reason_too_long"), now);
        DuplicateOfReportId = original.Id;
        Close(IncidentStatus.Duplicate, now);
    }

    // UC-28 step 4: official type/category confirmed by the Owner.
    public void Classify(string? officialCategory)
    {
        if (IsClosed) throw new MaintenanceStateException("incident_closed");
        OfficialCategory = Rules.OptionalText(officialCategory, 50, "category_too_long");
    }

    // UC-28 step 11 / A5: the first Work Order moves the report to In Progress; more may be added later.
    public void StartHandling(Guid ownerUserId, DateTimeOffset now)
    {
        if (Status == IncidentStatus.Submitted)
        {
            Decide(IncidentDecision.WorkOrder, ownerUserId, null, now);
            Status = IncidentStatus.InProgress;
        }
        else if (Status != IncidentStatus.InProgress) throw new MaintenanceStateException("incident_closed");
    }

    // UC-28 A4: Owner handles directly with result evidence and actual cost.
    public void ResolveDirectly(Guid ownerUserId, string resolutionNote, IReadOnlyList<EvidenceRef> resolutionEvidence,
        bool hasOpenWorkOrders, DateTimeOffset now)
    {
        EnsureCanBeClosedByOwner(hasOpenWorkOrders);
        var files = Rules.Evidence(resolutionEvidence, EvidenceKind.Resolution, 1);
        if (evidence.Count + files.Count > 2 * Rules.MaxEvidencePerSubmission) throw new MaintenanceValidationException("too_many_evidence_files");
        evidence.AddRange(files);
        Decide(IncidentDecision.HandledDirectly, ownerUserId, null, now);
        ResolutionNote = Rules.Text(resolutionNote, 2000, "resolution_note_required");
        Close(IncidentStatus.Resolved, now);
    }

    // UC-28 A7 (no action needed) and UC-30 A3 (all Work Orders cancelled, close with a note).
    public void ResolveWithoutAction(Guid ownerUserId, string resolutionNote, bool hasOpenWorkOrders, DateTimeOffset now)
    {
        EnsureCanBeClosedByOwner(hasOpenWorkOrders);
        Decide(IncidentDecision.NoActionNeeded, ownerUserId, null, now);
        ResolutionNote = Rules.Text(resolutionNote, 2000, "resolution_note_required");
        Close(IncidentStatus.Resolved, now);
    }

    // UC-30 step 9: resolved only when every Work Order is Verified/Cancelled and at least one is Verified.
    public bool TryResolveFromWorkOrders(IReadOnlyCollection<WorkOrderStatus> workOrderStatuses, DateTimeOffset now)
    {
        if (Status != IncidentStatus.InProgress || workOrderStatuses.Count == 0) return false;
        if (workOrderStatuses.Any(s => s is not (WorkOrderStatus.Verified or WorkOrderStatus.Cancelled))) return false;
        if (!workOrderStatuses.Contains(WorkOrderStatus.Verified)) return false;
        Close(IncidentStatus.Resolved, now);
        return true;
    }

    // UC-27 steps 5-6. The report stays Submitted until the Owner reviews it.
    public void Acknowledge(Guid actorUserId, DateTimeOffset now)
    {
        if (!IsEmergency) throw new MaintenanceStateException("not_emergency");
        if (IsClosed) throw new MaintenanceStateException("incident_closed");
        if (AcknowledgedAt is not null) throw new MaintenanceStateException("already_acknowledged");
        AcknowledgedByUserId = actorUserId;
        AcknowledgedAt = now;
        immediateActions.Add(new IncidentAction(IncidentActionType.Acknowledged, actorUserId, now, null, null, []));
    }

    // UC-27 steps 7-8, A4/A5: append-only first-response entries, optional cost and receipt/photo evidence.
    public void AddImmediateAction(Guid actorUserId, string note, decimal? amount, IReadOnlyList<EvidenceRef>? actionEvidence,
        DateTimeOffset now)
    {
        if (!IsEmergency) throw new MaintenanceStateException("not_emergency");
        if (IsClosed) throw new MaintenanceStateException("incident_closed");
        if (AcknowledgedAt is null) throw new MaintenanceStateException("acknowledge_first");
        if (immediateActions.Count >= 50) throw new MaintenanceStateException("too_many_actions");
        var files = Rules.Evidence(actionEvidence, EvidenceKind.Emergency, 0);
        evidence.AddRange(files);
        immediateActions.Add(new IncidentAction(IncidentActionType.ImmediateAction, actorUserId, now,
            Rules.Text(note, 1000, "action_note_required"), Rules.Money(amount, "invalid_amount"),
            files.Select(f => f.Key).ToArray()));
    }

    // UC-27 A1: unacknowledged emergency passed its deadline. Idempotent for repeated job runs.
    public bool MarkAcknowledgementOverdue(DateTimeOffset now)
    {
        if (!IsEmergency || IsClosed || AcknowledgedAt is not null || EscalatedAt is not null) return false;
        if (AckDueAt is null || AckDueAt > now) return false;
        EscalatedAt = now;
        immediateActions.Add(new IncidentAction(IncidentActionType.Escalated, Guid.Empty, now, null, null, []));
        return true;
    }

    public bool ContainsEvidence(string key) => evidence.Any(e => e.Key == key);

    private void EnsureSubmitted()
    {
        if (Status != IncidentStatus.Submitted) throw new MaintenanceStateException("incident_not_submitted");
    }

    private void EnsureCanBeClosedByOwner(bool hasOpenWorkOrders)
    {
        if (Status is not (IncidentStatus.Submitted or IncidentStatus.InProgress)) throw new MaintenanceStateException("incident_closed");
        if (hasOpenWorkOrders) throw new MaintenanceStateException("open_work_orders");
    }

    private void Decide(IncidentDecision decision, Guid ownerUserId, string? reason, DateTimeOffset now)
    {
        OwnerDecision = decision;
        OwnerDecidedByUserId = ownerUserId;
        OwnerDecidedAt = now;
        OwnerDecisionReason = reason;
    }

    private void Close(IncidentStatus status, DateTimeOffset now)
    {
        Status = status;
        ClosedAt = now;
    }
}
