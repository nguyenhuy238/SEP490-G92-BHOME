using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Notifications;
internal sealed class NotificationRepository(BHomeDbContext db) : INotificationRepository
{
    private IQueryable<UserNotification> Visible(NotificationScope s) => db.Set<UserNotification>().Where(n => n.RecipientUserId == s.Actor &&
        (s.Owner && n.AudienceRole == Roles.Owner || s.Tenant && n.AudienceRole == Roles.Tenant || s.Staff && n.AudienceRole == Roles.Staff && n.Category == "Task" && n.LocationId != null &&
         db.Locations.Any(l => l.Id == n.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a => a.LocationId == n.LocationId && a.StaffUserId == s.Actor && a.StartDate <= s.Today && a.EndDate >= s.Today)));
    private IQueryable<UserNotification> Unread(IQueryable<UserNotification> rows) => rows.Where(n => n.ReadAt == null && (n.SourceTaskNotificationId == null || !db.Set<OperationalTaskNotification>().Any(old => old.Id == n.SourceTaskNotificationId && old.ReadAt != null)));
    public Task<int> UnreadAsync(NotificationScope s, CancellationToken t) => Unread(Visible(s)).CountAsync(t);
    public async Task<PagedResult<NotificationView>> ListAsync(NotificationScope s, NotificationQuery q, CancellationToken t)
    {
        var rows = Visible(s).AsNoTracking(); if (q.Category is { } category) rows = rows.Where(n => n.Category == category);
        if (q.Unread is { } unread) rows = unread ? Unread(rows) : rows.Where(n => n.ReadAt != null || n.SourceTaskNotificationId != null && db.Set<OperationalTaskNotification>().Any(old => old.Id == n.SourceTaskNotificationId && old.ReadAt != null));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)
            .Select(n => new NotificationView(n.Id, n.Category, n.Title, n.Summary, n.RelatedObjectType, n.RelatedObjectId, n.CreatedAt, n.ReadAt ?? db.Set<OperationalTaskNotification>().Where(old => old.Id == n.SourceTaskNotificationId).Select(old => old.ReadAt).FirstOrDefault(), n.DeliveryState)).ToArrayAsync(t);
        return new(items, q.Page, q.PageSize, count);
    }
    public async Task ReadAsync(NotificationScope s, Guid? id, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); var rows = Visible(s).Where(n => id == null || n.Id == id);
        var sourceIds = rows.Where(n => n.SourceTaskNotificationId != null).Select(n => n.SourceTaskNotificationId);
        var updated = await rows.ExecuteUpdateAsync(set => set.SetProperty(n => n.ReadAt, n => n.ReadAt ?? db.Set<OperationalTaskNotification>().Where(old => old.Id == n.SourceTaskNotificationId).Select(old => old.ReadAt).FirstOrDefault() ?? now), t);
        if (id != null && updated == 0) throw new NotificationException(404, "notification_not_found");
        await db.Set<OperationalTaskNotification>().Where(old => old.RecipientUserId == s.Actor && sourceIds.Contains(old.Id) && old.ReadAt == null).ExecuteUpdateAsync(set => set.SetProperty(n => n.ReadAt, now), t);
        await tx.CommitAsync(t);
    }
    public async Task<NotificationTarget?> TargetAsync(NotificationScope s, Guid id, CancellationToken t)
    {
        var n = await Visible(s).AsNoTracking().SingleOrDefaultAsync(n => n.Id == id, t); if (n is null) return null;
        var allowed = n.RelatedObjectType switch
        {
            "Invoice" => await db.Set<Invoice>().AnyAsync(i => i.Id == n.RelatedObjectId && (s.Owner || s.Tenant && i.Recipients.Any(r => r.TenantUserId == s.Actor)), t),
            "Adjustment" => await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => r.Id == n.RelatedObjectId && (s.Owner || s.Tenant && r.RequesterId == s.Actor && r.Invoice.Recipients.Any(v => v.TenantUserId == s.Actor)), t),
            "Contract" => await db.Set<Contract>().AnyAsync(c => c.Id == n.RelatedObjectId && (s.Owner || s.Tenant && c.TenantUserId == s.Actor), t),
            "MeterTask" => await db.Set<OperationalTask>().AnyAsync(task => task.Id == n.RelatedObjectId && task.Kind == OperationalTaskKind.MeterReading && (s.Owner || s.Staff && task.Meter.Room.Location.IsActive && (task.AutomationPlanId == null || task.AssignedStaffUserId == s.Actor) && db.StaffLocationAssignments.Any(a => a.LocationId == task.Meter.Room.LocationId && a.StaffUserId == s.Actor && a.StartDate <= s.Today && a.EndDate >= s.Today)), t),
            "OperationalTask" => await db.Set<OperationalTask>().AnyAsync(task => task.Id == n.RelatedObjectId && task.Kind == OperationalTaskKind.AdHoc && (s.Owner || s.Staff && task.Location.IsActive && db.StaffLocationAssignments.Any(a => a.LocationId == task.LocationId && a.StaffUserId == s.Actor && a.StartDate <= s.Today && a.EndDate >= s.Today)), t),
            "AutomationExecution" => s.Owner && await db.Set<BillingAutomationExecution>().AnyAsync(e => e.Id == n.RelatedObjectId, t),
            _ => false
        };
        if (!allowed) return null;
        var period = n.RelatedObjectType == "AutomationExecution" ? await db.Set<BillingAutomationExecution>().Where(e => e.Id == n.RelatedObjectId).Select(e => (DateOnly?)e.BillingPeriod).SingleAsync(t) : null;
        return new(n.RelatedObjectType, n.RelatedObjectId, n.LocationId, period);
    }
}
