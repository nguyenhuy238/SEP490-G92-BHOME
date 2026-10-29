using System.Security.Cryptography;
using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-26: submit and cancel a report. Also the read side (list, detail, evidence download).
public sealed class IncidentReportService(IIncidentMaintenanceStore store, MaintenanceAccess access,
    MaintenanceEvidence evidence, MaintenanceNotifier notifier, ITenantRoomScope tenantRooms,
    IncidentMaintenanceOptions options)
{
    // SRS 6.1.1 hotline banner: life-safety cases call public services first (GBR-11).
    public static IReadOnlyList<EmergencyContact> EmergencyContacts { get; } =
    [
        new("114", "Cháy, nổ, cứu nạn cứu hộ"),
        new("115", "Cấp cứu y tế"),
        new("113", "Công an")
    ];

    public async Task<IncidentDetail> SubmitAsync(SubmitIncidentInput input, IReadOnlyList<EvidenceUpload>? photos,
        CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var userId = access.UserId;
        var scope = await ResolveScopeAsync(input, cancellationToken);
        var reporterRole = await ReporterRoleAsync(scope, cancellationToken);
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.Report, userId, now, cancellationToken);
        try
        {
            var report = IncidentReport.Submit(NewReportCode(now), userId, reporterRole, scope.LocationId, scope.RoomId,
                scope.AssetId, input.Severity, input.Summary, input.Description, files, now,
                TimeSpan.FromMinutes(options.OverdueMinutes));

            await using var transaction = await store.BeginTransactionAsync(cancellationToken);
            store.Add(report);
            store.Audit(userId, "IncidentSubmitted", "IncidentReport", report.Id);
            await store.SaveAsync(cancellationToken);
            if (report.IsEmergency)
                await notifier.OwnersAndLocationStaffAsync($"incident:{report.Id}:emergency",
                    MaintenanceTemplates.EmergencyReported, report, userId, cancellationToken);
            else
                await notifier.OwnersAsync($"incident:{report.Id}:submitted",
                    MaintenanceTemplates.IncidentSubmitted, report, userId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return MaintenanceMapper.ToDetail(report, [], internalView: reporterRole != IncidentReporterRole.Tenant);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
    }

    // A4: the reporter cancels before the Owner decides. A5: the Owner cancels with a reason.
    public async Task<IncidentDetail> CancelAsync(Guid id, OptionalReasonInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var viewer = await access.ViewerAsync(Permissions.Incidents.View, cancellationToken);
        var now = access.Now;

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = MaintenanceAccess.Visible(viewer, await store.FindIncidentAsync(id, cancellationToken));
        var orders = await store.WorkOrdersForIncidentAsync(id, cancellationToken);

        if (incident.ReporterUserId == viewer.UserId)
        {
            incident.CancelByReporter(viewer.UserId, input.Reason, now);
            store.Audit(viewer.UserId, "IncidentCancelledByReporter", "IncidentReport", id);
            await store.SaveAsync(cancellationToken);
            await notifier.OwnersAsync($"incident:{id}:cancelled", MaintenanceTemplates.IncidentCancelled,
                incident, viewer.UserId, cancellationToken);
        }
        else
        {
            var owner = access.RequireOwner(Permissions.Incidents.Review);
            incident.CancelByOwner(owner, input.Reason ?? "", orders.Any(o => o.IsOpen), now);
            store.Audit(owner, "IncidentCancelledByOwner", "IncidentReport", id);
            await store.SaveAsync(cancellationToken);
            await notifier.UsersAsync($"incident:{id}:cancelled", MaintenanceTemplates.IncidentCancelled,
                incident, [incident.ReporterUserId], owner, cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return MaintenanceMapper.ToDetail(incident, orders, InternalView(viewer));
    }

    public async Task<IReadOnlyList<IncidentSummary>> ListAsync(IncidentListQuery query, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Incidents.View, cancellationToken);
        return await store.ListIncidentsAsync(viewer, query with { Take = Math.Clamp(query.Take, 1, 100) }, cancellationToken);
    }

    public async Task<IncidentDetail> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Incidents.View, cancellationToken);
        var incident = MaintenanceAccess.Visible(viewer, await store.FindIncidentAsync(id, cancellationToken));
        var orders = await store.WorkOrdersForIncidentAsync(id, cancellationToken);
        return MaintenanceMapper.ToDetail(incident, orders, InternalView(viewer));
    }

    // Photos of a visible report or of its Work Orders. Served through the API, never as a public URL.
    public async Task<EvidenceFile> FindEvidenceAsync(Guid id, string fileId, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Incidents.View, cancellationToken);
        var incident = MaintenanceAccess.Visible(viewer, await store.FindIncidentAsync(id, cancellationToken));
        var key = MaintenanceEvidence.KeyFromFileId(fileId) ?? throw new MaintenanceNotFoundException();

        var orders = await store.WorkOrdersForIncidentAsync(id, cancellationToken);
        var file = incident.Evidence.Concat(orders.SelectMany(o => o.Evidence)).FirstOrDefault(e => e.Key == key)
            ?? throw new MaintenanceNotFoundException();
        return new EvidenceFile(file.ContentType, file.Key);
    }

    public Task CopyEvidenceAsync(EvidenceFile file, Stream destination, CancellationToken cancellationToken) =>
        evidence.CopyToAsync(file.ObjectKey, destination, cancellationToken);

    private sealed record ReportScope(Guid LocationId, Guid? RoomId, Guid? AssetId);

    // Location/Room come from the selected Asset or Room in the database, not from the client.
    private async Task<ReportScope> ResolveScopeAsync(SubmitIncidentInput input, CancellationToken cancellationToken)
    {
        if (input.AssetId is { } assetId)
        {
            var asset = await store.FindAssetAsync(assetId, cancellationToken) ?? throw new MaintenanceNotFoundException();
            if (asset.Status == AssetStatus.Retired) throw new MaintenanceValidationException("asset_retired");
            if (input.RoomId is { } room && asset.RoomId is { } assetRoom && room != assetRoom)
                throw new MaintenanceValidationException("scope_mismatch");
            var roomId = input.RoomId ?? asset.RoomId;
            if (roomId is { } r && (await store.FindRoomAsync(r, cancellationToken))?.LocationId != asset.LocationId)
                throw new MaintenanceValidationException("scope_mismatch");
            return new ReportScope(asset.LocationId, roomId, asset.Id);
        }

        if (input.RoomId is { } onlyRoom)
        {
            var room = await store.FindRoomAsync(onlyRoom, cancellationToken) ?? throw new MaintenanceNotFoundException();
            return new ReportScope(room.LocationId, room.RoomId, null);
        }

        // Common area of a Location.
        if (input.LocationId is { } locationId && await store.LocationExistsAsync(locationId, cancellationToken))
            return new ReportScope(locationId, null, null);

        throw new MaintenanceValidationException("scope_required");
    }

    // Preconditions: Staff must be assigned to the Location today; Tenant must rent the Room (or a Room there).
    private async Task<IncidentReporterRole> ReporterRoleAsync(ReportScope scope, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Incidents.Report, cancellationToken);
        if (viewer.StaffLocationIds.Contains(scope.LocationId)) return IncidentReporterRole.Staff;

        if (viewer.IsTenant)
        {
            var rooms = await tenantRooms.ActiveRoomsAsync(viewer.UserId, cancellationToken);
            var allowed = scope.RoomId is { } roomId
                ? rooms.Any(r => r.RoomId == roomId)
                : rooms.Any(r => r.LocationId == scope.LocationId);
            if (allowed) return IncidentReporterRole.Tenant;
        }
        throw new MaintenanceNotFoundException();
    }

    private static bool InternalView(MaintenanceViewer viewer) => viewer.IsOwner || viewer.IsStaff;

    // Example: SC-261029-K7Q2MX. Random suffix; the database keeps it unique.
    private static string NewReportCode(DateTimeOffset now) =>
        $"SC-{now:yyMMdd}-{RandomNumberGenerator.GetString("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}";
}
