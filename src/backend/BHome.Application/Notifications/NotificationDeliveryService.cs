using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Notifications;

public sealed class NotificationDeliveryOptions
{
    public bool Enabled { get; set; }
    public int MaxAttempts { get; set; } = 4;
    public int InitialRetrySeconds { get; set; } = 30;
    public int MaximumRetrySeconds { get; set; } = 3600;
    public int RequestTimeoutSeconds { get; set; } = 15;
    public int LeaseSeconds { get; set; } = 90;
    public bool Valid() => MaxAttempts is >= 1 and <= 10 && InitialRetrySeconds is >= 1 and <= 3600 && MaximumRetrySeconds >= InitialRetrySeconds && MaximumRetrySeconds <= 86400 && RequestTimeoutSeconds is >= 1 and <= 45 && LeaseSeconds > RequestTimeoutSeconds && LeaseSeconds <= 300;
}
public sealed record DeliveryWork(Guid Id, int Sequence);
public sealed record DeliveryClaim(Guid Id, Guid Token, int Sequence, DateTimeOffset StartedAt, Guid Recipient, string Category, string Title, string Summary);
public sealed record DeliveryCompletion(string State, string? ErrorCode, DateTimeOffset? NextAt, string? ProviderReference = null);
public sealed record DeliveryView(Guid Id, string Category, string RecipientRole, string RelatedObjectType, Guid RelatedObjectId, Guid? LocationId, string State, int Attempts, DateTimeOffset? NextAttemptAt, DateTimeOffset? LastAttemptAt, string? ErrorCode);
public sealed class DeliveryQuery { public int Page { get; set; } = 1; public int PageSize { get; set; } = 20; public string? State { get; set; } public Guid? LocationId { get; set; } }
public sealed record DeliveryOverview(bool Enabled, bool Configured, bool SupportsIdempotency, int MaxAttempts, PagedResult<DeliveryView> Deliveries);
public interface INotificationDeliveryStore
{
    Task<IReadOnlyList<DeliveryWork>> DueAsync(DateTimeOffset now, CancellationToken t);
    Task<DeliveryClaim?> ClaimAsync(Guid id, DateTimeOffset now, NotificationDeliveryOptions options, bool idempotency, CancellationToken t);
    Task CompleteAsync(DeliveryClaim claim, DeliveryCompletion result, DateTimeOffset now, CancellationToken t);
    Task<PagedResult<DeliveryView>> ListAsync(DeliveryQuery query, CancellationToken t);
}
public sealed class NotificationDeliveryService(INotificationDeliveryStore store, INotificationProvider provider, IBackgroundJobQueue queue, NotificationDeliveryOptions options, TimeProvider clock) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-delivery";
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        if (!options.Enabled || !provider.IsConfigured) return;
        foreach (var item in await store.DueAsync(clock.GetUtcNow(), t)) await queue.EnqueueAsync(new(Name, $"{item.Id:N}/external/{item.Sequence}", JsonSerializer.Serialize(item.Id)), t);
    }
    public async Task ExecuteAsync(JobExecution job, CancellationToken t) { await DeliverAsync(JsonSerializer.Deserialize<Guid>(job.PayloadJson), t); }
    public async Task<bool> DeliverAsync(Guid id, CancellationToken t)
    {
        var config = options; if (!config.Enabled || !provider.IsConfigured) return false;
        var claim = await store.ClaimAsync(id, clock.GetUtcNow(), config, provider.SupportsIdempotency, t); if (claim is null) return false;
        DeliveryCompletion result;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t); timeout.CancelAfter(TimeSpan.FromSeconds(config.RequestTimeoutSeconds));
            var receipt = await provider.DeliverAsync(new($"notification/{claim.Id:N}/external", claim.Recipient.ToString(), "notification.generic.v1", new Dictionary<string, string> { { "category", claim.Category }, { "title", claim.Title }, { "summary", claim.Summary } }), timeout.Token).WaitAsync(timeout.Token);
            if (string.IsNullOrWhiteSpace(receipt) || receipt.Length > 200) throw new InvalidOperationException("invalid_delivery_receipt");
            result = new("Delivered", null, null, receipt);
        }
        catch (OperationCanceledException) when (t.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            var state = !provider.SupportsIdempotency ? "PendingReview" : claim.Sequence >= config.MaxAttempts ? "Failed" : "Pending";
            var retry = state == "Pending" ? clock.GetUtcNow().AddSeconds(Math.Min(config.MaximumRetrySeconds, config.InitialRetrySeconds * Math.Pow(2, claim.Sequence - 1))) : (DateTimeOffset?)null;
            result = new(state, ex.GetType().Name, retry);
        }
        await store.CompleteAsync(claim, result, clock.GetUtcNow(), t); return true;
    }
    public DeliveryOverview Overview(PagedResult<DeliveryView> rows) => new(options.Enabled, provider.IsConfigured, provider.SupportsIdempotency, options.MaxAttempts, rows);
}
public sealed class NotificationDeliveryAdministration(NotificationDeliveryService delivery, INotificationDeliveryStore store, PermissionAccess permission)
{
    public async Task<DeliveryOverview> ListAsync(DeliveryQuery q, CancellationToken t)
    {
        if (!permission.HasPermission(Permissions.Locations.Manage)) throw new NotificationException(403, "notification_owner_required");
        if (q.Page < 1 || q.PageSize is < 1 or > 100 || q.Page > int.MaxValue / q.PageSize || q.LocationId == Guid.Empty || q.State is not (null or "Unconfigured" or "Pending" or "Processing" or "Delivered" or "Failed" or "PendingReview" or "Suppressed")) throw new NotificationException(400, "invalid_delivery_query");
        return delivery.Overview(await store.ListAsync(q, t));
    }
}
