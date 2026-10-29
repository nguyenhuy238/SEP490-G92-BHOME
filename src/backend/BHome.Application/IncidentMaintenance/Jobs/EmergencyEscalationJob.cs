using BHome.Application.IncidentMaintenance.Services;

namespace BHome.Application.IncidentMaintenance.Jobs;

// JOB-11 (plan D6), UC-27 A1. Run every minute by a hosted service:
// - not acknowledged after ReminderMinutes: remind Owner + Location Staff (the queue key sends it once),
// - past AckDueAt (OverdueMinutes): flag the report as overdue once and notify again.
// Safe to run repeatedly or on several instances: both steps are idempotent.
public sealed class EmergencyEscalationJob(IIncidentMaintenanceStore store, MaintenanceNotifier notifier,
    IncidentMaintenanceOptions options, TimeProvider clock)
{
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var waiting = await store.UnacknowledgedEmergenciesAsync(now.AddMinutes(-options.ReminderMinutes), 50, cancellationToken);
        foreach (var incident in waiting)
        {
            await using var transaction = await store.BeginTransactionAsync(cancellationToken);
            await notifier.OwnersAndLocationStaffAsync($"incident:{incident.Id}:emergency-reminder",
                MaintenanceTemplates.EmergencyReminder, incident, Guid.Empty, cancellationToken);

            if (incident.MarkAcknowledgementOverdue(now))
            {
                await store.SaveAsync(cancellationToken);
                await notifier.OwnersAndLocationStaffAsync($"incident:{incident.Id}:emergency-overdue",
                    MaintenanceTemplates.EmergencyOverdue, incident, Guid.Empty, cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
        }
        return waiting.Count;
    }
}
