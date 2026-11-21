using System.Net;
using System.Net.Http.Json;
using BHome.Application.Notifications;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private static UserNotification Notice(Guid recipient, string role, string key, Guid invoice, Guid location) => new() { RecipientUserId = recipient, AudienceRole = role, EventKey = key, Category = "Invoice", Title = "Hóa đơn có cập nhật", Summary = "Vui lòng mở hóa đơn để xem thông tin trong phạm vi của bạn.", RelatedObjectType = "Invoice", RelatedObjectId = invoice, LocationId = location, CreatedAt = DateTimeOffset.UtcNow };
    [Fact]
    public async Task InboxIsRecipientScopedPaginatedAndReadStatePersistsWithoutCrossTenantMutation()
    {
        var w = await Setup(); var a = Notice(w.Tenants[0], Roles.Tenant, "test:a", w.Invoice, w.Location); var b = Notice(w.Tenants[0], Roles.Tenant, "test:b", w.Invoice, w.Location); var foreign = Notice(w.Tenants[1], Roles.Tenant, "test:a", w.Invoice, w.Location);
        await using (var s = fixture.Factory.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); db.AddRange(a, b, foreign, Notice(w.Owner, Roles.Owner, "test:a", w.Invoice, w.Location)); await db.SaveChangesAsync(); }
        using var tenant = await Client(w.Tenants[0]); using var owner = await Client(w.Owner);
        Assert.Equal(2, (await tenant.GetFromJsonAsync<NotificationCount>("/api/v1/notifications/unread-count"))!.UnreadCount);
        var page = (await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?pageSize=1&category=Invoice"))!; Assert.Equal(2, page.TotalCount); Assert.Single(page.Items); Assert.Equal(1, (await owner.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications"))!.TotalCount);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.PostAsync($"/api/v1/notifications/{foreign.Id}/read", null)).StatusCode);
        (await tenant.PostAsync($"/api/v1/notifications/{a.Id}/read", null)).EnsureSuccessStatusCode();
        using var reopened = await Client(w.Tenants[0]); Assert.Equal(1, (await reopened.GetFromJsonAsync<NotificationCount>("/api/v1/notifications/unread-count"))!.UnreadCount);
        (await reopened.PostAsync("/api/v1/notifications/read-all", null)).EnsureSuccessStatusCode(); Assert.Equal(0, (await reopened.GetFromJsonAsync<NotificationCount>("/api/v1/notifications/unread-count"))!.UnreadCount);
        Assert.Equal(HttpStatusCode.BadRequest, (await tenant.GetAsync("/api/v1/notifications?pageSize=101")).StatusCode);
        using var other = await Client(w.Tenants[1]); Assert.Equal(1, (await other.GetFromJsonAsync<NotificationCount>("/api/v1/notifications/unread-count"))!.UnreadCount);
    }
    [Fact]
    public async Task NotificationTargetRechecksInvoiceEntitlementInsteadOfTrustingSavedLink()
    {
        var w = await Setup(); var other = await Setup(); var valid = Notice(w.Tenants[0], Roles.Tenant, "target:valid", w.Invoice, w.Location); var invalid = Notice(w.Tenants[0], Roles.Tenant, "target:invalid", other.Invoice, w.Location);
        await using (var s = fixture.Factory.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); db.AddRange(valid, invalid); await db.SaveChangesAsync(); }
        using var tenant = await Client(w.Tenants[0]); Assert.Equal(w.Invoice, (await tenant.GetFromJsonAsync<NotificationTarget>($"/api/v1/notifications/{valid.Id}/target"))!.ObjectId); Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/notifications/{invalid.Id}/target")).StatusCode);
    }
    [Fact]
    public async Task StaffInboxMirrorsTaskReadStateAndLosesAccessWhenAssignmentEnds()
    {
        var (w, p, _) = await MeterWorkspace(); await RunMeter(w); Guid noticeId, sourceId;
        await using (var s = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var task = await db.Set<OperationalTask>().FirstAsync(t => t.AutomationPlanId == p.Id); var source = await db.Set<OperationalTaskNotification>().SingleAsync(n => n.TaskId == task.Id); sourceId = source.Id;
            var notice = Notice(w.Staff, Roles.Staff, "task:" + source.Id, task.Id, w.Location); notice.Category = "Task"; notice.RelatedObjectType = "MeterTask"; notice.SourceTaskNotificationId = source.Id; noticeId = notice.Id; db.Add(notice); await db.SaveChangesAsync();
        }
        using var staff = await Client(w.Staff); Assert.Equal(1, (await staff.GetFromJsonAsync<NotificationCount>("/api/v1/notifications/unread-count"))!.UnreadCount); Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync($"/api/v1/notifications/{noticeId}/target")).StatusCode);
        (await staff.PostAsync($"/api/v1/notifications/{noticeId}/read", null)).EnsureSuccessStatusCode();
        await using (var s = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); Assert.NotNull((await db.Set<OperationalTaskNotification>().SingleAsync(n => n.Id == sourceId)).ReadAt);
            var today = BillingAutomationDates.BusinessDate(DateTimeOffset.UtcNow); foreach (var a in await db.StaffLocationAssignments.Where(a => a.LocationId == w.Location).ToArrayAsync()) db.Entry(a).Property(x => x.EndDate).CurrentValue = today.AddDays(-1); await db.SaveChangesAsync();
        }
        Assert.Equal(0, (await staff.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications"))!.TotalCount); Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsync($"/api/v1/notifications/{noticeId}/read", null)).StatusCode);
    }
}
