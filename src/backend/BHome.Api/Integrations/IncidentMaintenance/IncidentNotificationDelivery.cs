using System.Text.Json;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.IncidentMaintenance;

internal sealed class IncidentNotificationDelivery(BHomePersistenceContext db, IIncidentRepository repository,
    INotificationProvider provider, TimeProvider clock, BHome.Application.Notifications.INotificationEventPublisher? publisher = null,
    Microsoft.Extensions.Options.IOptions<BHome.Application.Notifications.NotificationChannelOptions>? channels = null) : IBackgroundJobHandler
{
    public string Name => "incident.notification";
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext && publisher is not null && channels?.Value.Enabled == true)
        { await publisher.PublishPendingAsync(t); return; }
        var payload = JsonSerializer.Deserialize<DeliveryPayload>(job.PayloadJson) ?? throw new InvalidOperationException("invalid_notification_job");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"incident-delivery:" + payload.NotificationId}, 0))", t);
        var compact = db as Compact24DbContext;
        var row = compact is null
            ? await db.Set<IncidentNotification>().SingleOrDefaultAsync(n => n.Id == payload.NotificationId, t)
            : await NativeIncidentSession.ReadNotificationAsync(compact, payload.NotificationId, t);
        if (row is null || row.DeliveryState is "Delivered" or "Suppressed") return;
        async Task SaveAsync()
        {
            if (compact is not null) await NativeIncidentWrites.WriteAsync(compact, row, false, null, t);
            else await db.SaveChangesAsync(t);
            await tx.CommitAsync(t);
        }
        var report = row.IncidentId is { } incident ? await repository.IncidentAsync(incident, t) : null;
        var work = row.WorkOrderId is { } workId ? await repository.WorkOrderAsync(workId, t) : null;
        var location = report?.LocationId ?? work?.LocationId ?? throw IncidentException.Missing();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        var eligible = await repository.ActiveRoleAsync(row.RecipientId, Roles.Owner, t) ||
            await repository.ActiveRoleAsync(row.RecipientId, Roles.Staff, t) && await repository.StaffAssignedAsync(row.RecipientId, location, today, t) ||
            report?.ReporterRole == Roles.Tenant && report.ReporterId == row.RecipientId && await repository.ActiveRoleAsync(row.RecipientId, Roles.Tenant, t);
        if (!eligible)
        { row.DeliveryState = "Suppressed"; await SaveAsync(); return; }
        string deliveryReference;
        try
        {
            deliveryReference = await provider.DeliverAsync(new(row.Id.ToString("N"), row.RecipientId.ToString("N"),
                "incident." + row.Event, new Dictionary<string, string>
                {
                    ["resourceId"] = (row.IncidentId ?? row.WorkOrderId!.Value).ToString("N"),
                    ["priority"] = row.HighPriority ? "high" : "normal"
                }), t);
            if (string.IsNullOrWhiteSpace(deliveryReference) || deliveryReference.Length > 200)
                throw new InvalidOperationException("invalid_delivery_reference");
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Commit delivery failure only. The related incident transaction was already committed.
            row.DeliveryReference = null; row.DeliveryError = "delivery_pending";
            var attempts = compact is null
                ? await db.BackgroundJobs.Where(j => j.Id == job.Id).Select(j => (int?)j.Attempts).SingleOrDefaultAsync(t)
                : await compact.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking()
                    .Where(j => j.Id == job.Id && j.TaskType == "SYSTEM_JOB")
                    .Select(j => (int?)j.AttemptCount).SingleOrDefaultAsync(t);
            row.DeliveryState = attempts >= BHome.Infrastructure.Jobs.PostgresJobWorker.MaxAttempts ? "Failed" : "Pending";
            await SaveAsync(); throw;
        }
        row.DeliveryReference = deliveryReference; row.DeliveryState = "Delivered"; row.DeliveryError = null;
        await SaveAsync();
    }
    private sealed record DeliveryPayload(Guid NotificationId);
}
