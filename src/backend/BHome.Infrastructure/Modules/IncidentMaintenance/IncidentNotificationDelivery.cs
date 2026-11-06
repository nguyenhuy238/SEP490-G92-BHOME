using System.Text.Json;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.IncidentMaintenance;

internal sealed class IncidentNotificationDelivery(BHomePersistenceContext db, IIncidentRepository repository,
    INotificationProvider provider, TimeProvider clock) : IBackgroundJobHandler
{
    public string Name => "incident.notification";
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        var payload = JsonSerializer.Deserialize<DeliveryPayload>(job.PayloadJson) ?? throw new InvalidOperationException("invalid_notification_job");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"incident-delivery:" + payload.NotificationId}, 0))", t);
        var row = await db.Set<IncidentNotification>().SingleOrDefaultAsync(n => n.Id == payload.NotificationId, t);
        if (row is null || row.DeliveryState is "Delivered" or "Suppressed") return;
        var report = await repository.IncidentAsync(row.IncidentId, t) ?? throw IncidentException.Missing();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        var eligible = await repository.ActiveRoleAsync(row.RecipientId, Roles.Owner, t) ||
            await repository.ActiveRoleAsync(row.RecipientId, Roles.Staff, t) && await repository.StaffAssignedAsync(row.RecipientId, report.LocationId, today, t) ||
            report.ReporterRole == Roles.Tenant && report.ReporterId == row.RecipientId && await repository.ActiveRoleAsync(row.RecipientId, Roles.Tenant, t);
        if (!eligible)
        { row.DeliveryState = "Suppressed"; await db.SaveChangesAsync(t); await tx.CommitAsync(t); return; }
        string deliveryReference;
        try
        {
            deliveryReference = await provider.DeliverAsync(new(row.Id.ToString("N"), row.RecipientId.ToString("N"),
                "incident." + row.Event, new Dictionary<string, string>
                {
                    ["incidentId"] = row.IncidentId.ToString("N"),
                    ["priority"] = row.HighPriority ? "high" : "normal"
                }), t);
            if (string.IsNullOrWhiteSpace(deliveryReference) || deliveryReference.Length > 200)
                throw new InvalidOperationException("invalid_delivery_reference");
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Commit delivery failure only. The related incident transaction was already committed.
            row.DeliveryReference = null; row.DeliveryError = "delivery_pending";
            var attempts = await db.BackgroundJobs.Where(j => j.Id == job.Id).Select(j => (int?)j.Attempts).SingleOrDefaultAsync(t);
            row.DeliveryState = attempts >= BHome.Infrastructure.Jobs.PostgresJobWorker.MaxAttempts ? "Failed" : "Pending";
            await db.SaveChangesAsync(t); await tx.CommitAsync(t); throw;
        }
        row.DeliveryReference = deliveryReference; row.DeliveryState = "Delivered"; row.DeliveryError = null;
        await db.SaveChangesAsync(t); await tx.CommitAsync(t);
    }
    private sealed record DeliveryPayload(Guid NotificationId);
}
