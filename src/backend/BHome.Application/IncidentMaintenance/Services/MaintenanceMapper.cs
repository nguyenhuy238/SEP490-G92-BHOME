using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// Entity -> response DTO. Tenants do not receive costs or internal actor ids (least privilege, API-02).
internal static class MaintenanceMapper
{
    public static IncidentDetail ToDetail(IncidentReport r, IReadOnlyList<MaintenanceWorkOrder> orders, bool internalView)
    {
        var actions = r.ImmediateActions.Select(a => new IncidentActionItem(
            a.Type,
            internalView ? a.ActorUserId : Guid.Empty,
            a.At,
            a.Note,
            internalView ? a.Amount : null,
            a.EvidenceKeys.Select(MaintenanceEvidence.FileId).ToArray())).ToArray();

        return new IncidentDetail(r.Id, r.ReportCode, r.ReporterUserId, r.ReporterRole, r.LocationId, r.RoomId, r.AssetId,
            r.Severity, r.Status, r.Summary, r.Description, r.SubmittedAt,
            r.Evidence.Select(ToItem).ToArray(),
            internalView ? r.AcknowledgedByUserId : null, r.AcknowledgedAt, r.AckDueAt, r.EscalatedAt,
            actions,
            r.OwnerDecision, r.OwnerDecidedAt, r.OwnerDecisionReason, r.DuplicateOfReportId, r.OfficialCategory,
            r.ResolutionNote, r.CancelReason, r.ClosedAt,
            orders.Select(o => ToSummary(o, r.ReportCode, internalView)).ToArray());
    }

    public static WorkOrderSummary ToSummary(MaintenanceWorkOrder o, string reportCode, bool internalView = true) =>
        new(o.Id, o.IncidentReportId, reportCode, o.LocationId, o.RoomId, o.AssetId,
            internalView ? o.AssignedStaffUserId : Guid.Empty, o.Status, o.IsPlanApproved, o.DueAt, o.CreatedAt);

    public static WorkOrderDetail ToDetail(MaintenanceWorkOrder o, IncidentReport incident) =>
        new(o.Id, o.IncidentReportId, incident.ReportCode, incident.Summary, incident.Description, incident.Severity,
            o.LocationId, o.RoomId, o.AssetId, o.AssignedStaffUserId, o.Status, o.WorkDescription, o.ExpectedOutcome, o.DueAt,
            o.InspectionResult, o.ProposedPlan, o.EstimatedDuration, o.EstimatedCost, o.IsPlanApproved, o.CostApprovedAt,
            o.PlanRejectionReason, o.StartedAt, o.ResultSummary, o.SubmittedAt, o.ActualCost, o.CostVarianceReason,
            o.VerifiedAt, o.ReworkReason, o.CancelReason,
            o.Evidence.Select(ToItem).ToArray(),
            o.History.Select(h => new WorkOrderEntryItem(h.Type, h.ActorUserId, h.At, h.FromStatus, h.ToStatus, h.Note,
                h.StaffUserId)).ToArray());

    public static EvidenceItem ToItem(EvidenceRef e) =>
        new(MaintenanceEvidence.FileId(e.Key), e.Kind, e.At, e.ContentType, e.Length);
}
