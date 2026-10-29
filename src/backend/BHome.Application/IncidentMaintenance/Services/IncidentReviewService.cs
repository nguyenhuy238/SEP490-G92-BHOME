using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-28: the Owner reviews a report and decides how it is handled.
public sealed class IncidentReviewService(IIncidentMaintenanceStore store, MaintenanceAccess access,
    MaintenanceEvidence evidence, MaintenanceNotifier notifier, IMaintenanceDirectory directory,
    IMaintenanceExpenseRecorder expenses)
{
    // Step 4: confirm the official category.
    public async Task<IncidentDetail> ClassifyAsync(Guid id, ClassifyInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        access.RequireOwner(Permissions.Incidents.Review);
        var incident = await LoadAsync(id, cancellationToken);

        incident.Classify(input.OfficialCategory);
        await store.SaveAsync(cancellationToken);
        return await DetailAsync(incident, cancellationToken);
    }

    // A1: invalid report, reason required, reporter receives MSG19.
    public async Task<IncidentDetail> RejectAsync(Guid id, ReasonInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = await LoadAsync(id, cancellationToken);
        incident.Reject(owner, input.Reason, access.Now);
        store.Audit(owner, "IncidentRejected", "IncidentReport", id);
        await store.SaveAsync(cancellationToken);
        await NotifyReporterAsync(incident, "rejected", MaintenanceTemplates.RejectedOrDuplicate, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await DetailAsync(incident, cancellationToken);
    }

    // A2: link to the original report, reporter receives MSG19.
    public async Task<IncidentDetail> MarkDuplicateAsync(Guid id, DuplicateInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = await LoadAsync(id, cancellationToken);
        var original = await store.FindIncidentAsync(input.OriginalReportId, cancellationToken)
            ?? throw new MaintenanceValidationException("original_not_found");
        incident.MarkDuplicate(owner, original, input.Reason, access.Now);
        store.Audit(owner, "IncidentMarkedDuplicate", "IncidentReport", id);
        await store.SaveAsync(cancellationToken);
        await NotifyReporterAsync(incident, "duplicate", MaintenanceTemplates.RejectedOrDuplicate, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await DetailAsync(incident, cancellationToken);
    }

    // A7 (no action needed) and UC-30 A3 (every Work Order cancelled): close with a note.
    public async Task<IncidentDetail> ResolveWithoutActionAsync(Guid id, ResolveInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = await LoadAsync(id, cancellationToken);
        var orders = await store.WorkOrdersForIncidentAsync(id, cancellationToken);
        incident.ResolveWithoutAction(owner, input.ResolutionNote, orders.Any(o => o.IsOpen), access.Now);
        store.Audit(owner, "IncidentResolvedWithoutAction", "IncidentReport", id);
        await store.SaveAsync(cancellationToken);
        await NotifyReporterAsync(incident, "resolved", MaintenanceTemplates.IncidentResolved, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await DetailAsync(incident, cancellationToken);
    }

    // A4: the Owner fixes it directly: >= 1 result photo, actual cost -> OperatingExpense, Asset back to Active.
    public async Task<IncidentDetail> HandleDirectlyAsync(Guid id, HandleDirectlyInput input,
        IReadOnlyList<EvidenceUpload>? photos, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);
        var incident = await LoadAsync(id, cancellationToken);
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.Resolution, owner, now, cancellationToken);
        try
        {
            await using var transaction = await store.BeginTransactionAsync(cancellationToken);
            var orders = await store.WorkOrdersForIncidentAsync(id, cancellationToken);
            incident.ResolveDirectly(owner, input.ResolutionNote, files, orders.Any(o => o.IsOpen), now);

            if (incident.AssetId is { } assetId && await store.FindAssetAsync(assetId, cancellationToken) is { } asset)
                asset.CompleteRepair(await store.HasOpenWorkOrdersForAssetAsync(assetId, null, cancellationToken));

            if (input.ActualCost > 0)
                await expenses.RecordAsync(new MaintenanceExpense($"IR:{id}", incident.LocationId, incident.RoomId,
                    incident.AssetId, id, null, input.ActualCost, access.Today,
                    $"Sự cố {incident.ReportCode} – Owner tự xử lý", owner), cancellationToken);

            store.Audit(owner, "IncidentHandledDirectly", "IncidentReport", id);
            await store.SaveAsync(cancellationToken);
            await NotifyReporterAsync(incident, "resolved", MaintenanceTemplates.IncidentResolved, owner, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
        return await DetailAsync(incident, cancellationToken);
    }

    // Steps 5-12 and A5: assign a Work Order to Staff assigned to the report's Location.
    public async Task<WorkOrderSummary> CreateWorkOrderAsync(Guid id, CreateWorkOrderInput input,
        CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Incidents.Review);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = await LoadAsync(id, cancellationToken);
        var eligibleStaff = await directory.StaffAssignedToLocationAsync(incident.LocationId, cancellationToken);
        if (!eligibleStaff.Contains(input.StaffUserId))
            throw new MaintenanceValidationException("staff_not_assigned_to_location");

        if (input.OfficialCategory is not null) incident.Classify(input.OfficialCategory);
        var order = MaintenanceWorkOrder.Create(incident, owner, input.StaffUserId, input.WorkDescription,
            input.ExpectedOutcome, input.DueAt, access.Now);
        if (incident.AssetId is { } assetId && await store.FindAssetAsync(assetId, cancellationToken) is { } asset)
            asset.MarkNeedsRepair();

        store.Add(order);
        store.Audit(owner, "WorkOrderCreated", "MaintenanceWorkOrder", order.Id);
        await store.SaveAsync(cancellationToken);
        await notifier.UsersAsync($"workorder:{order.Id}:assigned:{input.StaffUserId:N}",
            MaintenanceTemplates.WorkOrderAssigned, incident, [input.StaffUserId], owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return MaintenanceMapper.ToSummary(order, incident.ReportCode);
    }

    private async Task<IncidentReport> LoadAsync(Guid id, CancellationToken cancellationToken) =>
        await store.FindIncidentAsync(id, cancellationToken) ?? throw new MaintenanceNotFoundException();

    private async Task<IncidentDetail> DetailAsync(IncidentReport incident, CancellationToken cancellationToken) =>
        MaintenanceMapper.ToDetail(incident, await store.WorkOrdersForIncidentAsync(incident.Id, cancellationToken), true);

    private Task NotifyReporterAsync(IncidentReport incident, string eventName, string template, Guid owner,
        CancellationToken cancellationToken) =>
        notifier.UsersAsync($"incident:{incident.Id}:{eventName}", template, incident, [incident.ReporterUserId], owner,
            cancellationToken);
}
