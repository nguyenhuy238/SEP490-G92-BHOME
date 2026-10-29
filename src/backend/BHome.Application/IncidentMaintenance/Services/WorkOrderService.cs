using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-29 (Staff inspects, proposes, executes, submits) and UC-30 (Owner verifies), plus Owner
// reassignment/cancellation and the maintenance history screen (6.4.1).
public sealed class WorkOrderService(IIncidentMaintenanceStore store, MaintenanceAccess access,
    MaintenanceEvidence evidence, MaintenanceNotifier notifier, IMaintenanceDirectory directory,
    IMaintenanceExpenseRecorder expenses)
{
    // ---------------- Reads ----------------

    public async Task<IReadOnlyList<WorkOrderSummary>> ListAsync(WorkOrderListQuery query, CancellationToken cancellationToken)
    {
        var viewer = await ViewerAsync(cancellationToken);
        return await store.ListWorkOrdersAsync(viewer, query with { Take = Math.Clamp(query.Take, 1, 100) }, cancellationToken);
    }

    public async Task<WorkOrderDetail> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        var viewer = await ViewerAsync(cancellationToken);
        var order = MaintenanceAccess.Visible(viewer, await store.FindWorkOrderAsync(id, cancellationToken));
        return await DetailAsync(order, cancellationToken);
    }

    public async Task<IReadOnlyList<MaintenanceHistoryItem>> HistoryAsync(MaintenanceHistoryQuery query,
        CancellationToken cancellationToken)
    {
        access.RequireOwner(Permissions.Incidents.Review);
        return await store.MaintenanceHistoryAsync(query with { Take = Math.Clamp(query.Take, 1, 200) }, cancellationToken);
    }

    // ---------------- UC-29: assigned Staff ----------------

    // Steps 1-8: inspection result, plan, duration, estimated cost and optional before photos.
    public async Task<WorkOrderDetail> SubmitProposalAsync(Guid id, ProposalInput input, IReadOnlyList<EvidenceUpload>? photos,
        CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var (staff, order) = await LoadForStaffAsync(id, cancellationToken);
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.Before, staff, now, cancellationToken);
        try
        {
            await using var transaction = await store.BeginTransactionAsync(cancellationToken);
            order.SubmitProposal(staff, input.InspectionResult, input.ProposedPlan, input.EstimatedDuration,
                input.EstimatedCost, files, now);
            await store.SaveAsync(cancellationToken);
            await NotifyOwnersAsync(order, "proposal", MaintenanceTemplates.ProposalSubmitted, staff, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
        return await DetailAsync(order, cancellationToken);
    }

    // Steps 12-13: start after the Owner approved the plan. The Asset becomes Under Repair.
    public async Task<WorkOrderDetail> StartAsync(Guid id, CancellationToken cancellationToken)
    {
        var (staff, order) = await LoadForStaffAsync(id, cancellationToken);

        order.Start(staff, access.Now);
        if (order.AssetId is { } assetId && await store.FindAssetAsync(assetId, cancellationToken) is { } asset)
            asset.MarkUnderRepair();
        await store.SaveAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // Steps 14-15: progress note with optional photos.
    public async Task<WorkOrderDetail> AddProgressAsync(Guid id, NoteInput input, IReadOnlyList<EvidenceUpload>? photos,
        CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var (staff, order) = await LoadForStaffAsync(id, cancellationToken);
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.Progress, staff, now, cancellationToken);
        try
        {
            order.AddProgress(staff, input.Note, files, now);
            await store.SaveAsync(cancellationToken);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
        return await DetailAsync(order, cancellationToken);
    }

    // A2, A4, A5, A6: blocker / contractor needed / replacement proposal / delay, recorded in history.
    public async Task<WorkOrderDetail> ReportBlockerAsync(Guid id, NoteInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var (staff, order) = await LoadForStaffAsync(id, cancellationToken);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.ReportBlocker(staff, input.Note, access.Now);
        await store.SaveAsync(cancellationToken);
        await NotifyOwnersAsync(order, "blocker", MaintenanceTemplates.WorkOrderBlocked, staff, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // Steps 16-20: result + at least one after photo; Owner receives MSG14.
    public async Task<WorkOrderDetail> SubmitForVerificationAsync(Guid id, SubmitResultInput input,
        IReadOnlyList<EvidenceUpload>? photos, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var (staff, order) = await LoadForStaffAsync(id, cancellationToken);
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.After, staff, now, cancellationToken);
        try
        {
            await using var transaction = await store.BeginTransactionAsync(cancellationToken);
            order.SubmitForVerification(staff, input.ResultSummary, files, now);
            await store.SaveAsync(cancellationToken);
            await NotifyOwnersAsync(order, "submitted", MaintenanceTemplates.SubmittedForVerification, staff, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
        return await DetailAsync(order, cancellationToken);
    }

    // ---------------- UC-29 / UC-30: Owner ----------------

    // UC-29 steps 9-11.
    public async Task<WorkOrderDetail> ApprovePlanAsync(Guid id, CancellationToken cancellationToken)
    {
        var owner = access.RequireOwner(Permissions.WorkOrders.ApprovePlan);
        var order = await LoadAsync(id, cancellationToken);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.ApprovePlan(owner, access.Now);
        store.Audit(owner, "WorkOrderPlanApproved", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await NotifyStaffAsync(order, "plan-approved", MaintenanceTemplates.PlanDecided, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // UC-29 A1: back to Assigned with a reason so Staff can revise.
    public async Task<WorkOrderDetail> RejectPlanAsync(Guid id, ReasonInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.WorkOrders.ApprovePlan);
        var order = await LoadAsync(id, cancellationToken);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.RejectPlan(owner, input.Reason, access.Now);
        store.Audit(owner, "WorkOrderPlanRejected", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await NotifyStaffAsync(order, "plan-rejected", MaintenanceTemplates.PlanDecided, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // UC-30 steps 4-10: actual cost -> OperatingExpense, Asset -> Active (D10), report -> Resolved when complete.
    public async Task<WorkOrderDetail> VerifyAsync(Guid id, VerifyInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.WorkOrders.Verify);
        var order = await LoadAsync(id, cancellationToken);
        var incident = await LoadIncidentAsync(order, cancellationToken);
        var now = access.Now;

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.Verify(owner, input.ActualCost, input.CostVarianceReason, now);

        if (order.AssetId is { } assetId && await store.FindAssetAsync(assetId, cancellationToken) is { } asset)
            asset.CompleteRepair(await store.HasOpenWorkOrdersForAssetAsync(assetId, order.Id, cancellationToken));

        if (input.ActualCost > 0)
            await expenses.RecordAsync(new MaintenanceExpense($"WO:{order.Id}", order.LocationId, order.RoomId, order.AssetId,
                order.IncidentReportId, order.Id, input.ActualCost, access.Today,
                $"Bảo trì cho sự cố {incident.ReportCode}", owner), cancellationToken);

        store.Audit(owner, "WorkOrderVerified", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await TryResolveIncidentAsync(incident, owner, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return MaintenanceMapper.ToDetail(order, incident);
    }

    // UC-30 A1: back to In Progress with a reason; Staff receives MSG15.
    public async Task<WorkOrderDetail> RequestReworkAsync(Guid id, ReasonInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.WorkOrders.Verify);
        var order = await LoadAsync(id, cancellationToken);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.RequestRework(owner, input.Reason, access.Now);
        store.Audit(owner, "WorkOrderReworkRequested", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await NotifyStaffAsync(order, "rework", MaintenanceTemplates.ReworkRequested, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // UC-30 A3. If the other Work Orders are already done, the report may resolve now.
    public async Task<WorkOrderDetail> CancelAsync(Guid id, ReasonInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);
        var order = await LoadAsync(id, cancellationToken);
        var incident = await LoadIncidentAsync(order, cancellationToken);
        var now = access.Now;

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.Cancel(owner, input.Reason, now);
        store.Audit(owner, "WorkOrderCancelled", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await NotifyStaffAsync(order, "cancelled", MaintenanceTemplates.WorkOrderCancelled, owner, cancellationToken);
        await TryResolveIncidentAsync(incident, owner, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return MaintenanceMapper.ToDetail(order, incident);
    }

    // UC-28 A6: another Staff assigned to the same Location; status and history are kept.
    public async Task<WorkOrderDetail> ReassignAsync(Guid id, ReassignInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);
        var order = await LoadAsync(id, cancellationToken);
        var eligibleStaff = await directory.StaffAssignedToLocationAsync(order.LocationId, cancellationToken);
        if (!eligibleStaff.Contains(input.StaffUserId))
            throw new MaintenanceValidationException("staff_not_assigned_to_location");

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        order.Reassign(owner, input.StaffUserId, input.Reason, access.Now);
        store.Audit(owner, "WorkOrderReassigned", "MaintenanceWorkOrder", id);
        await store.SaveAsync(cancellationToken);
        await NotifyStaffAsync(order, $"assigned:{input.StaffUserId:N}", MaintenanceTemplates.WorkOrderAssigned, owner,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await DetailAsync(order, cancellationToken);
    }

    // ---------------- Helpers ----------------

    // Owner sees all Work Orders; Staff only their own in currently assigned Locations.
    private async Task<MaintenanceViewer> ViewerAsync(CancellationToken cancellationToken)
    {
        var staff = await access.ViewerAsync(Permissions.WorkOrders.Execute, cancellationToken);
        return staff with { IsOwner = access.Has(Permissions.Incidents.Review, Roles.Owner) };
    }

    private async Task<(Guid StaffUserId, MaintenanceWorkOrder Order)> LoadForStaffAsync(Guid id,
        CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.WorkOrders.Execute, cancellationToken);
        var order = MaintenanceAccess.Visible(viewer with { IsOwner = false },
            await store.FindWorkOrderAsync(id, cancellationToken));
        return (viewer.UserId, order);
    }

    private async Task<MaintenanceWorkOrder> LoadAsync(Guid id, CancellationToken cancellationToken) =>
        await store.FindWorkOrderAsync(id, cancellationToken) ?? throw new MaintenanceNotFoundException();

    private async Task<IncidentReport> LoadIncidentAsync(MaintenanceWorkOrder order, CancellationToken cancellationToken) =>
        await store.FindIncidentAsync(order.IncidentReportId, cancellationToken) ?? throw new MaintenanceNotFoundException();

    private async Task<WorkOrderDetail> DetailAsync(MaintenanceWorkOrder order, CancellationToken cancellationToken) =>
        MaintenanceMapper.ToDetail(order, await LoadIncidentAsync(order, cancellationToken));

    // UC-30 step 9: resolve once every Work Order is Verified/Cancelled and at least one is Verified.
    private async Task TryResolveIncidentAsync(IncidentReport incident, Guid owner, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orders = await store.WorkOrdersForIncidentAsync(incident.Id, cancellationToken);
        if (!incident.TryResolveFromWorkOrders(orders.Select(o => o.Status).ToArray(), now)) return;

        store.Audit(owner, "IncidentResolved", "IncidentReport", incident.Id);
        await store.SaveAsync(cancellationToken);
        await notifier.UsersAsync($"incident:{incident.Id}:resolved", MaintenanceTemplates.IncidentResolved, incident,
            [incident.ReporterUserId], owner, cancellationToken);
    }

    // The event key includes the history length so a repeated step (e.g. a second rework) is a new event.
    private async Task NotifyOwnersAsync(MaintenanceWorkOrder order, string eventName, string template, Guid actor,
        CancellationToken cancellationToken)
    {
        var incident = await LoadIncidentAsync(order, cancellationToken);
        await notifier.OwnersAsync($"workorder:{order.Id}:{eventName}:{order.History.Count}", template, incident, actor,
            cancellationToken);
    }

    private async Task NotifyStaffAsync(MaintenanceWorkOrder order, string eventName, string template, Guid actor,
        CancellationToken cancellationToken)
    {
        var incident = await LoadIncidentAsync(order, cancellationToken);
        await notifier.UsersAsync($"workorder:{order.Id}:{eventName}:{order.History.Count}", template, incident,
            [order.AssignedStaffUserId], actor, cancellationToken);
    }
}
