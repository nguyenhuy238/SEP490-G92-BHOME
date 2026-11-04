using BHome.Application.Billing;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class NotificationDeliveryStore(BHomePersistenceContext db, INotificationRepository inbox) : INotificationDeliveryStore
{
    public async Task<IReadOnlyList<DeliveryWork>> DueAsync(DateTimeOffset now, CancellationToken t) => await db.Set<UserNotification>().AsNoTracking().Where(n => n.DeliveryState == "Unconfigured" && n.DeliveryAttempts == 0 || n.DeliveryState == "Pending" && n.NextDeliveryAt <= now || n.DeliveryState == "Processing" && n.DeliveryLockedUntil <= now).OrderBy(n => n.CreatedAt).Take(50).Select(n => new DeliveryWork(n.Id, n.DeliveryAttempts + 1)).ToArrayAsync(t);
    public async Task<PagedResult<DeliveryView>> ListAsync(DeliveryQuery q, CancellationToken t)
    {
        var rows = db.Set<UserNotification>().AsNoTracking().Where(n => (q.State == null || n.DeliveryState == q.State) && (q.LocationId == null || n.LocationId == q.LocationId)); var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize).Select(n => new DeliveryView(n.Id, n.Category, n.AudienceRole, n.RelatedObjectType, n.RelatedObjectId, n.LocationId, n.DeliveryState, n.DeliveryAttempts, n.NextDeliveryAt, n.DeliveryLastAttemptAt, n.DeliveryLastErrorCode)).ToArrayAsync(t); return new(items, q.Page, q.PageSize, count);
    }
    public async Task<DeliveryClaim?> ClaimAsync(Guid id, DateTimeOffset now, NotificationDeliveryOptions options, bool idempotency, CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        var n = await db.Locked<UserNotification>(id, skipLocked: true).SingleOrDefaultAsync(t);
        if (n is null || n.DeliveryState is "Delivered" or "Failed" or "PendingReview" or "Suppressed" || n.NextDeliveryAt > now || n.DeliveryLockedUntil > now) return null;
        var active = await (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join role in db.Roles on grant.RoleId equals role.Id where u.Id == n.RecipientUserId && u.IsActive && role.Name == n.AudienceRole select u.Id).AnyAsync(t);
        var scope = new NotificationScope(n.RecipientUserId, n.AudienceRole == Roles.Owner, n.AudienceRole == Roles.Staff, n.AudienceRole == Roles.Tenant, BillingAutomationDates.BusinessDate(now));
        if (!active || await inbox.TargetAsync(scope, n.Id, t) is null) { n.DeliveryState = "Suppressed"; n.DeliveryLastErrorCode = "recipient_scope_unavailable"; await db.SaveChangesAsync(t); await tx.CommitAsync(t); return null; }
        if (n.DeliveryState == "Processing")
        {
            db.Add(new NotificationDeliveryAttempt { NotificationId = n.Id, Sequence = n.DeliveryAttempts, StartedAt = n.DeliveryLastAttemptAt ?? now, FinishedAt = now, Outcome = idempotency ? "LeaseExpired" : "PendingReview", ErrorCode = "delivery_lease_expired" });
            if (!idempotency) { n.DeliveryState = "PendingReview"; n.DeliveryLastErrorCode = "ambiguous_delivery_recovery"; n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null; await db.SaveChangesAsync(t); await tx.CommitAsync(t); return null; }
        }
        if (n.DeliveryAttempts >= options.MaxAttempts) { n.DeliveryState = "Failed"; n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null; await db.SaveChangesAsync(t); await tx.CommitAsync(t); return null; }
        n.DeliveryState = "Processing"; n.DeliveryAttempts++; n.DeliveryLastAttemptAt = now; n.DeliveryLockedUntil = now.AddSeconds(options.LeaseSeconds); n.DeliveryLeaseToken = Guid.NewGuid(); n.NextDeliveryAt = null;
        await db.SaveChangesAsync(t); await tx.CommitAsync(t); return new(n.Id, n.DeliveryLeaseToken.Value, n.DeliveryAttempts, now, n.RecipientUserId, n.Category, n.Title, n.Summary);
    }
    public async Task CompleteAsync(DeliveryClaim claim, DeliveryCompletion result, DateTimeOffset now, CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        var n = await db.Locked<UserNotification>(claim.Id).SingleAsync(t);
        if (n.DeliveryLeaseToken != claim.Token) return;
        n.DeliveryState = result.State; n.DeliveryLastErrorCode = result.ErrorCode; n.NextDeliveryAt = result.NextAt; n.DeliveryProviderReference = result.ProviderReference; n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null;
        db.Add(new NotificationDeliveryAttempt { NotificationId = n.Id, Sequence = claim.Sequence, StartedAt = claim.StartedAt, FinishedAt = now, Outcome = result.State, ErrorCode = result.ErrorCode }); await db.SaveChangesAsync(t); await tx.CommitAsync(t);
    }
}
