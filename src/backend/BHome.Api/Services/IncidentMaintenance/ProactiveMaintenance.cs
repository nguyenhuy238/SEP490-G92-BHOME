using System.Security.Cryptography;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

public sealed partial class IncidentService
{
    private async Task<MaintenanceContext> ContextAsync(MaintenanceWorkOrder work, CancellationToken t)
    {
        if (work.IncidentId is { } id)
        {
            var report = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing();
            return new(id, work.LocationId, work.RoomId, work.CommonArea ?? report.CommonArea, work.AssetId,
                report.ReporterId, report.Severity, report);
        }
        return new(null, work.LocationId, work.RoomId, work.CommonArea, work.AssetId, null, IncidentSeverity.Normal, null);
    }

    private async Task<IncidentScope> WorkAccessAsync(MaintenanceContext context, CancellationToken t)
    {
        var scope = await ScopeAsync(t);
        if (scope.Owner || scope.Staff && await repository.StaffAssignedAsync(Actor, context.LocationId, Today, t)) return scope;
        throw IncidentException.Missing();
    }

    private async Task ValidateTargetAsync(Guid location, Guid? room, string? commonArea, Guid? assetId, CancellationToken t)
    {
        if (location == Guid.Empty || room == Guid.Empty || assetId == Guid.Empty ||
            room.HasValue == !string.IsNullOrWhiteSpace(commonArea)) throw IncidentException.Invalid("invalid_maintenance_scope");
        if (!await repository.ActiveLocationAsync(location, t)) throw IncidentException.Missing();
        if (room is { } roomId && (await repository.RoomAsync(roomId, t))?.LocationId != location) throw IncidentException.Missing();
        if (assetId is not { } id) return;
        var asset = await repository.AssetAsync(id, t) ?? throw IncidentException.Missing();
        if (asset.LocationId != location || asset.RoomId != room || room is null && asset.CommonArea != commonArea?.Trim())
            throw IncidentException.Missing();
        if (asset.Status == AssetStatus.Retired) throw IncidentException.Conflict("asset_retired");
    }

    public async Task<MaintenanceAssignment> AssignmentAsync(Guid location, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Manage, t);
        if (!await repository.ActiveLocationAsync(location, t)) throw IncidentException.Missing();
        var staff = await repository.ResponsibleStaffAsync(location, Today, t);
        return new(staff, staff.HasValue);
    }

    public async Task<IncidentCommandResult> CreateProactiveAsync(ProactiveMaintenance input, Guid key, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Manage, t);
        var description = Text(input.Description, 10); var outcome = Text(input.ExpectedOutcome, 1, 4000);
        var area = input.RoomId.HasValue ? null : Text(input.CommonArea, 1, 200);
        await ValidateTargetAsync(input.LocationId, input.RoomId, area, input.AssetId, t);
        return await CommandAsync(input.LocationId, input.RoomId, key, "proactive", input,
            () => PermitAsync(Permissions.Incidents.Manage, t), async () =>
        {
            await ValidateTargetAsync(input.LocationId, input.RoomId, area, input.AssetId, t);
            if (input.TargetCompletionAt <= Now) throw IncidentException.Invalid("invalid_target_completion");
            var staff = await repository.ResponsibleStaffAsync(input.LocationId, Today, t) ?? throw IncidentException.Conflict("staff_unavailable");
            var order = new MaintenanceWorkOrder
            {
                Source = "Proactive",
                LocationId = input.LocationId,
                RoomId = input.RoomId,
                CommonArea = area,
                AssetId = input.AssetId,
                Description = description,
                ExpectedOutcome = outcome,
                TargetCompletionAt = input.TargetCompletionAt.ToUniversalTime(),
                AssignedStaffId = staff
            };
            repository.Add(order);
            if (order.AssetId is { } assetId)
            {
                var asset = await repository.AssetAsync(assetId, t) ?? throw IncidentException.Missing();
                if (asset.Status != AssetStatus.UnderRepair) { asset.Status = AssetStatus.NeedsRepair; asset.Version++; }
            }
            var context = await ContextAsync(order, t);
            var activity = Activity(context, order, "assigned", description, false, input);
            await NotifyAsync(context, activity, [staff], t);
            return new(null, order.Id);
        }, t);
    }

    public async Task<IncidentPage<IncidentActivityView>> WorkHistoryAsync(Guid id, int page, int size, CancellationToken t)
    {
        await WorkOrderAsync(id, t); Page(page, size);
        return await repository.WorkHistoryAsync(id, await ScopeAsync(t), page, size, t);
    }

    public async Task<IReadOnlyList<IncidentEvidenceView>> WorkEvidenceAsync(Guid id, CancellationToken t)
    {
        await WorkOrderAsync(id, t);
        return (await repository.WorkEvidenceAsync(id, t)).Select(e => new IncidentEvidenceView(e.Id, e.WorkOrderId,
            e.ActivityId, e.Kind.ToString(), e.ContentType, e.Length)).ToArray();
    }

    public async Task<string> CopyWorkEvidenceAsync(Guid id, Guid imageId, Stream output, CancellationToken t)
    {
        await WorkOrderAsync(id, t);
        var evidence = (await repository.WorkEvidenceAsync(id, t)).SingleOrDefault(e => e.Id == imageId) ?? throw IncidentException.Missing();
        await files.CopyAsync(evidence.ObjectKey, output, t); return evidence.ContentType;
    }

    public async Task<IncidentCommandResult> UploadWorkEvidenceAsync(Guid id, IncidentEvidenceKind kind, Guid key, Stream stream, CancellationToken t)
    {
        await PermitAsync(Permissions.WorkOrders.Execute, t);
        var initial = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
        await RequireExecutionAsync(await ContextAsync(initial, t), initial, t);
        if (kind is not (IncidentEvidenceKind.Inspection or IncidentEvidenceKind.Completion)) throw IncidentException.Invalid("invalid_evidence_kind");
        using var memory = new MemoryStream();
        var buffer = new byte[81920];
        try
        {
            int count;
            while ((count = await stream.ReadAsync(buffer, t)) > 0)
            {
                if (memory.Length + count > MaximumImageBytes) throw new IncidentException(413, "incident_image_too_large");
                await memory.WriteAsync(buffer.AsMemory(0, count), t);
            }
            var content = memory.ToArray();
            try
            {
                var type = files.Validate(content); var hash = Convert.ToHexString(SHA256.HashData(content));
                return await CommandAsync(initial.LocationId, initial.RoomId, key, "work-evidence:" + id, new { kind, hash }, async () =>
                {
                    var current = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
                    await RequireExecutionAsync(await ContextAsync(current, t), current, t);
                }, async () =>
                {
                    var current = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
                    if (kind == IncidentEvidenceKind.Inspection && current.Status is not (WorkOrderStatus.Assigned or WorkOrderStatus.PendingApproval) ||
                        kind == IncidentEvidenceKind.Completion && current.Status != WorkOrderStatus.InProgress)
                        throw IncidentException.Conflict("evidence_not_allowed_in_state");
                    var rows = await repository.WorkEvidenceAsync(id, t);
                    if (rows.Count(e => e.Kind == kind && e.ActivityId == null && e.UploadedById == Actor) >= MaximumImages)
                        throw IncidentException.Conflict("incident_evidence_limit");
                    var context = await ContextAsync(current, t);
                    var row = await StoreAsync(context, id, kind, null, content, type, hash, t);
                    Activity(context, current, "evidence_uploaded", "", false, new { EvidenceId = row.Id });
                    return new(current.IncidentId, id, row.Id);
                }, t);
            }
            finally { CryptographicOperations.ZeroMemory(content); }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(buffer);
            CryptographicOperations.ZeroMemory(memory.GetBuffer().AsSpan(0, (int)memory.Length));
        }
    }
}
