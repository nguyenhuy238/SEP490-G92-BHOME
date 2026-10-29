using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

public sealed record MaintenanceNotification(string Template, bool HighPriority, IReadOnlyList<Guid> Recipients,
    IReadOnlyDictionary<string, string> Parameters);

// Enqueued in the same transaction as the business change (GBR-14: delivery failure never rolls it back).
// The idempotency key is the business event, so retries and repeated jobs do not duplicate (GBR-18).
// Parameters carry only the report code/status: no names, descriptions or amounts (API-02).
public sealed class MaintenanceNotifier(IBackgroundJobQueue queue, IMaintenanceDirectory directory)
{
    public const string JobName = "incident-maintenance.notify";

    public async Task OwnersAsync(string eventKey, string template, IncidentReport incident, Guid actorUserId,
        CancellationToken cancellationToken, bool highPriority = false) =>
        await SendAsync(eventKey, template, incident, await directory.OwnerUserIdsAsync(cancellationToken), actorUserId,
            highPriority, cancellationToken);

    // UC-27 step 3 / plan D9: shift data (UC-09) does not exist yet, so every Staff assigned to the Location.
    public async Task OwnersAndLocationStaffAsync(string eventKey, string template, IncidentReport incident, Guid actorUserId,
        CancellationToken cancellationToken)
    {
        var recipients = (await directory.OwnerUserIdsAsync(cancellationToken))
            .Concat(await directory.StaffAssignedToLocationAsync(incident.LocationId, cancellationToken)).ToArray();
        await SendAsync(eventKey, template, incident, recipients, actorUserId, true, cancellationToken);
    }

    public Task UsersAsync(string eventKey, string template, IncidentReport incident, IEnumerable<Guid> recipients,
        Guid actorUserId, CancellationToken cancellationToken) =>
        SendAsync(eventKey, template, incident, recipients.ToArray(), actorUserId, false, cancellationToken);

    private async Task SendAsync(string eventKey, string template, IncidentReport incident, IReadOnlyList<Guid> recipients,
        Guid actorUserId, bool highPriority, CancellationToken cancellationToken)
    {
        var targets = recipients.Where(id => id != Guid.Empty && id != actorUserId).Distinct().ToArray();
        if (targets.Length == 0) return;
        var payload = new MaintenanceNotification(template, highPriority, targets, new Dictionary<string, string>
        {
            ["reportCode"] = incident.ReportCode,
            ["status"] = incident.Status.ToString()
        });
        await queue.EnqueueAsync(new JobSubmission(JobName, eventKey, JsonSerializer.Serialize(payload)), cancellationToken);
    }
}

// SRS V.2 message ids used as notification templates.
public static class MaintenanceTemplates
{
    public const string IncidentSubmitted = "INCIDENT_SUBMITTED";
    public const string EmergencyReported = "MSG13";
    public const string EmergencyAcknowledged = "EMERGENCY_ACKNOWLEDGED";
    public const string EmergencyReminder = "EMERGENCY_REMINDER";
    public const string EmergencyOverdue = "EMERGENCY_OVERDUE";
    public const string RejectedOrDuplicate = "MSG19";
    public const string IncidentCancelled = "INCIDENT_CANCELLED";
    public const string WorkOrderAssigned = "MSG20";
    public const string ProposalSubmitted = "PROPOSAL_SUBMITTED";
    public const string PlanDecided = "PLAN_DECIDED";
    public const string WorkOrderBlocked = "WORK_ORDER_BLOCKED";
    public const string SubmittedForVerification = "MSG14";
    public const string ReworkRequested = "MSG15";
    public const string WorkOrderCancelled = "WORK_ORDER_CANCELLED";
    public const string IncidentResolved = "MSG22";
}
