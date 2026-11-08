using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Notifications;

public sealed class NotificationQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public string? Category { get; set; }
    public bool? Unread { get; set; }
}
public sealed record NotificationView(Guid Id, string Category, string Title, string Summary, string RelatedObjectType, Guid RelatedObjectId, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt, string DeliveryState,
    string EventType = "", string Priority = "P1", string Source = "System")
{
    public bool IsRead => ReadAt is not null;
    // A navigation hint, never an authorization grant; clients must resolve /target and fetch the business API again.
    public NotificationAction? Action => RelatedObjectId == Guid.Empty || string.IsNullOrEmpty(RelatedObjectType) ? null :
        new("OPEN_" + (RelatedObjectType switch { "OperationalTask" => "TASK", "MeterTask" => "METER_TASK", "BankTransfer" => "BANK_TRANSACTION", _ => RelatedObjectType.ToUpperInvariant() }), RelatedObjectId);
}
public sealed record NotificationAction(string Type, Guid EntityId);
public sealed record NotificationTarget(string ObjectType, Guid ObjectId, Guid? LocationId = null, DateOnly? BillingPeriod = null);
public sealed record NotificationCount(int UnreadCount);
public sealed record NotificationScope(Guid Actor, bool Owner, bool Staff, bool Tenant, DateOnly Today);
public sealed class NotificationException(int status, string code) : Exception("Notification operation rejected.") { public int Status => status; public string Code => code; }
public interface INotificationRepository
{
    Task<PagedResult<NotificationView>> ListAsync(NotificationScope scope, NotificationQuery query, CancellationToken t);
    Task<int> UnreadAsync(NotificationScope scope, CancellationToken t);
    Task ReadAsync(NotificationScope scope, Guid? notificationId, DateTimeOffset now, CancellationToken t);
    Task<NotificationTarget?> TargetAsync(NotificationScope scope, Guid id, CancellationToken t);
    Task<NotificationView?> GetAsync(NotificationScope scope, Guid id, CancellationToken t) => Task.FromResult<NotificationView?>(null);
}
public sealed class NotificationService(INotificationRepository repository, ICurrentUser user, PermissionAccess permission, TimeProvider clock)
{
    private NotificationScope Scope
    {
        get
        {
            if (user.UserId is not { } actor) throw new NotificationException(401, "authentication_required");
            if (!permission.HasPermission(Permissions.Notifications.ReadOwn)) throw new NotificationException(403, "notification_forbidden");
            return new(actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Staff), user.IsInRole(Roles.Tenant), BillingAutomationDates.BusinessDate(clock.GetUtcNow()));
        }
    }
    public Task<PagedResult<NotificationView>> ListAsync(NotificationQuery q, CancellationToken t)
    {
        var scope = Scope;
        if (q.Page < 1 || q.PageSize is < 1 or > 100 || q.Page > int.MaxValue / q.PageSize || q.Category is not (null or "Contract" or "Invoice" or "Payment" or "Adjustment" or "Task" or "Incident" or "Account" or "Announcement" or "Residence" or "Other")) throw new NotificationException(400, "invalid_notification_query");
        return repository.ListAsync(scope, q, t);
    }
    public async Task<NotificationCount> UnreadAsync(CancellationToken t) => new(await repository.UnreadAsync(Scope, t));
    public Task ReadAsync(Guid? id, CancellationToken t) => repository.ReadAsync(Scope, id, clock.GetUtcNow(), t);
    public async Task<NotificationView> GetAsync(Guid id, CancellationToken t) => await repository.GetAsync(Scope, id, t) ?? throw new NotificationException(404, "notification_not_found");
    public async Task<NotificationTarget> TargetAsync(Guid id, CancellationToken t) => await repository.TargetAsync(Scope, id, t) ?? throw new NotificationException(404, "notification_target_unavailable");
}
