using System.Text.Json;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Application.Integrations;
using BHome.Application.Jobs;

namespace BHome.Application.IncidentMaintenance.Jobs;

// Delivers one queued incident/maintenance notification to each recipient (JOB-04 retry applies).
// Each delivery has its own idempotency key, so a retried job does not send twice through the provider.
public sealed class IncidentNotificationJobHandler(INotificationProvider provider) : IBackgroundJobHandler
{
    public string Name => MaintenanceNotifier.JobName;

    public async Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken)
    {
        var notification = JsonSerializer.Deserialize<MaintenanceNotification>(job.PayloadJson)
            ?? throw new InvalidOperationException("Notification payload is empty.");
        foreach (var recipient in notification.Recipients)
        {
            var delivery = new NotificationDelivery($"{job.IdempotencyKey}:{recipient:N}", recipient.ToString(),
                notification.Template, notification.Parameters);
            await provider.DeliverAsync(delivery, cancellationToken);
        }
    }
}
