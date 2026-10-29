using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-27: Staff (or Owner) acknowledges an emergency and records first-response actions.
// The report stays Submitted; the Owner still reviews it in UC-28.
public sealed class EmergencyResponseService(IIncidentMaintenanceStore store, MaintenanceAccess access,
    MaintenanceEvidence evidence, MaintenanceNotifier notifier, IMaintenanceDirectory directory)
{
    public async Task<IncidentDetail> AcknowledgeAsync(Guid id, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Incidents.RespondEmergency, cancellationToken);

        await using var transaction = await store.BeginTransactionAsync(cancellationToken);
        var incident = MaintenanceAccess.Visible(viewer, await store.FindIncidentAsync(id, cancellationToken));
        incident.Acknowledge(viewer.UserId, access.Now);
        store.Audit(viewer.UserId, "EmergencyAcknowledged", "IncidentReport", id);
        await store.SaveAsync(cancellationToken);

        var recipients = (await directory.OwnerUserIdsAsync(cancellationToken)).Append(incident.ReporterUserId);
        await notifier.UsersAsync($"incident:{id}:acknowledged", MaintenanceTemplates.EmergencyAcknowledged,
            incident, recipients, viewer.UserId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return MaintenanceMapper.ToDetail(incident, [], internalView: true);
    }

    // Steps 7-8, A4/A5: append-only note with optional cost and photos (e.g. receipt).
    public async Task<IncidentDetail> AddImmediateActionAsync(Guid id, ImmediateActionInput input,
        IReadOnlyList<EvidenceUpload>? photos, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var viewer = await access.ViewerAsync(Permissions.Incidents.RespondEmergency, cancellationToken);
        var incident = MaintenanceAccess.Visible(viewer, await store.FindIncidentAsync(id, cancellationToken));
        var now = access.Now;

        var files = await evidence.UploadAsync(photos, EvidenceKind.Emergency, viewer.UserId, now, cancellationToken);
        try
        {
            incident.AddImmediateAction(viewer.UserId, input.Note, input.Amount, files, now);
            store.Audit(viewer.UserId, "EmergencyActionRecorded", "IncidentReport", id);
            await store.SaveAsync(cancellationToken);
            return MaintenanceMapper.ToDetail(incident, [], internalView: true);
        }
        catch
        {
            await evidence.DeleteAsync(files);
            throw;
        }
    }
}
