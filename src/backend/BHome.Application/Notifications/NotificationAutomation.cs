using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Notifications;
public interface INotificationEventPublisher{Task<int> PublishPendingAsync(CancellationToken t);}
public sealed record NotificationProcessResult(int CreatedCount);
public sealed class NotificationAutomationService(INotificationEventPublisher publisher,PermissionAccess permission,BillingAutomationRuntime runtime)
{
    public async Task<NotificationProcessResult> PublishAsync(CancellationToken t)
    {
        if(!permission.HasPermission(Permissions.Locations.Manage))throw new NotificationException(403,"notification_owner_required");
        if(!runtime.DeveloperActionsEnabled)throw new NotificationException(403,"developer_actions_disabled");
        return new(await publisher.PublishPendingAsync(t));
    }
}
