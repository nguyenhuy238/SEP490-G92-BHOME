using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher(BHomePersistenceContext db, IBackgroundJobQueue queue, TimeProvider clock, CompactNotificationEvents? extended = null) : INotificationEventPublisher, IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-publish";
    public Task EnqueueDueAsync(CancellationToken t) => queue.EnqueueAsync(new(Name, clock.GetUtcNow().ToString("yyyyMMddHHmm"), "{}"), t);
    public async Task ExecuteAsync(JobExecution job, CancellationToken t) { await PublishPendingAsync(t); }
    private sealed record Intent(Guid Recipient, string Role, Guid Location, string Category, string Title, string Summary, string Type, Guid ObjectId, Guid? TaskSource = null, DateTimeOffset? ReadAt = null, string EventType = "", string Priority = "P1", string[]? Channels = null);
    private Task<bool> ActiveRole(Guid id, string role, CancellationToken t) => (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id == id && u.IsActive && r.Name == role select u.Id).AnyAsync(t);
    private async Task<int> Publish(string key, Func<Task<IReadOnlyList<Intent>>> resolve, CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"notification:" + key},0))", t);
        if (await db.Set<NotificationPublication>().AnyAsync(p => p.EventKey == key, t)) return 0;
        var count = 0; var recipients = 0;
        foreach (var i in (await resolve()).DistinctBy(i => i.Recipient))
        {
            if (!await ActiveRole(i.Recipient, i.Role, t)) continue; recipients++;
            if (await db.Set<UserNotification>().AnyAsync(n => n.RecipientUserId == i.Recipient && n.EventKey == key, t)) continue;
            db.Add(new UserNotification { Id = Guid.NewGuid(), RecipientUserId = i.Recipient, AudienceRole = i.Role,
                LocationId = i.Location, Category = i.Category, Title = i.Title, Summary = i.Summary,
                RelatedObjectType = i.Type, RelatedObjectId = i.ObjectId, EventKey = key,
                EventType = i.EventType.Length > 0 ? i.EventType : EventType(key), Priority = i.Priority, Channels = i.Channels ?? ["IN_APP", "PUSH"],
                SourceTaskNotificationId = i.TaskSource, CreatedAt = clock.GetUtcNow(), ReadAt = i.ReadAt, DeliveryState = "Unconfigured" });
            count++;
        }
        db.Add(new NotificationPublication { EventKey = key, PublishedAt = clock.GetUtcNow(), RecipientCount = recipients }); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return count;
    }
    private static string EventType(string key) => key.Split(':')[0] switch
    {
        "invoice" => "INVOICE_FINALIZED", "adjustment" => key.Contains("requested") ? "INVOICE_ADJUSTMENT_REQUESTED" : "INVOICE_ADJUSTMENT_DECIDED",
        "contract-expiry" => "CONTRACT_EXPIRY_REMINDER", "task" => "TASK_UPDATED", "billing-exception" => "INVOICE_FINALIZATION_BLOCKED",
        "move-out" => "MOVE_OUT_STATUS_CHANGED", _ => "CONTRACT_STATUS_CHANGED"
    };
    private async Task<List<Intent>> InvoiceAudience(Invoice invoice, string category, string title, string summary, CancellationToken t, Guid? extraOwner = null)
    {
        var list = new List<Intent>();
        foreach (var owner in new[] { invoice.FinalizedByUserId ?? invoice.CreatedByUserId, extraOwner ?? Guid.Empty }.Where(id => id != Guid.Empty).Distinct()) list.Add(new(owner, Roles.Owner, invoice.LocationId, category, title, summary, "Invoice", invoice.Id, Channels: category == "Invoice" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]));
        foreach (var id in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).ToArrayAsync(t)) list.Add(new(id, Roles.Tenant, invoice.LocationId, category, title, summary, "Invoice", invoice.Id, Channels: category == "Invoice" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]));
        return list;
    }
    public async Task<int> PublishPendingAsync(CancellationToken t)
    {
        var count = 0;
        var invoices = await db.Set<InvoiceIssuedEvent>().AsNoTracking().Where(e => !db.Set<NotificationPublication>().Any(p => p.EventKey == "invoice:" + e.InvoiceId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in invoices) count += await Publish("invoice:" + e.InvoiceId, async () =>
        {
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t);
            return i.Status != InvoiceStatus.Final ? [] : await InvoiceAudience(i, "Invoice", "Hóa đơn đã phát hành", $"Kỳ {i.BillingPeriod:MM/yyyy} đã có hóa đơn chính thức. Mở hóa đơn để xem nghĩa vụ hiện hành.", t, e.OwnerUserId);
        }, t);
        var payments = await db.Set<PaymentConfirmedEvent>().AsNoTracking().Where(e => !db.Set<NotificationPublication>().Any(p => p.EventKey == "payment:" + e.AllocationId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in payments) count += await Publish("payment:" + e.AllocationId, async () =>
        {
            var allocation = await db.Set<PaymentAllocation>().AsNoTracking().SingleAsync(a => a.Id == e.AllocationId && a.InvoiceId == e.InvoiceId, t);
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t);
            if (i.Status != InvoiceStatus.Final) return [];
            var balance = await BHome.Infrastructure.Billing.InvoiceFinancialQueries.FinancialsAsync(db, i.Id, t);
            var outstanding = e.OutstandingAmount ?? balance.OutstandingAmount;
            var paid = e.PaidAmount ?? balance.AllocatedPayments;
            var full = outstanding == 0;
            if (full && await db.Set<UserNotification>().AnyAsync(n => n.RelatedObjectId == i.Id && n.EventType == "INVOICE_FULLY_PAID", t)) return [];
            var notices = await InvoiceAudience(i, "Payment", full ? "Hóa đơn đã thanh toán đủ" : "Đã xác nhận thanh toán một phần",
                $"Phòng {i.RoomNumber} đã thanh toán {paid:N0} VND; còn phải trả {outstanding:N0} VND. Mã xác nhận nội bộ {allocation.Id.ToString("N")[..8]}.", t, allocation.VerifiedByUserId);
            return notices.Select(n => n with { EventType = full ? "INVOICE_FULLY_PAID" : "PAYMENT_PARTIALLY_CONFIRMED", Channels = full ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"] }).ToArray();
        }, t);
        var adjustments = await db.Set<InvoiceAdjustmentEvent>().AsNoTracking().Where(e => !db.Set<NotificationPublication>().Any(p => p.EventKey == "adjustment:" + e.RequestId.ToString() + ":" + e.Name)).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in adjustments) count += await Publish("adjustment:" + e.RequestId + ":" + e.Name, async () =>
        {
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t); var list = new List<Intent>();
            if (e.Name == "invoice.adjustment.requested.v1") list.Add(new(i.FinalizedByUserId ?? i.CreatedByUserId, Roles.Owner, i.LocationId, "Adjustment", "Có yêu cầu điều chỉnh hóa đơn", $"Kỳ {i.BillingPeriod:MM/yyyy} có yêu cầu cần Owner xem xét.", "Adjustment", e.RequestId));
            else if (e.Name == "invoice.adjustment.decided.v1")
            {
                var decision = await db.Set<InvoiceAdjustmentDecision>().AsNoTracking().SingleAsync(d => d.RequestId == e.RequestId, t); var approved = decision.Outcome == "Approved";
                list.Add(new(e.RequesterId, Roles.Tenant, i.LocationId, "Adjustment", approved ? "Yêu cầu điều chỉnh đã được duyệt" : "Yêu cầu điều chỉnh đã bị từ chối", "Mở yêu cầu của bạn để xem kết quả được phép truy cập.", "Adjustment", e.RequestId));
                if (approved) foreach (var id in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == i.Id && r.TenantUserId != e.RequesterId).Select(r => r.TenantUserId).ToArrayAsync(t)) list.Add(new(id, Roles.Tenant, i.LocationId, "Adjustment", "Hóa đơn có cập nhật", $"Vui lòng xem nghĩa vụ hiện hành của hóa đơn kỳ {i.BillingPeriod:MM/yyyy}.", "Invoice", i.Id));
            }
            return list;
        }, t);
        var expiries = extended is not null ? [] : await db.Set<ContractExpiryNotice>().AsNoTracking().Where(e => !db.Set<NotificationPublication>().Any(p => p.EventKey == "contract-expiry:" + e.Id.ToString())).OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in expiries) count += await Publish("contract-expiry:" + e.Id, async () =>
        {
            var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleAsync(c => c.Id == e.ContractId, t); var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
            if (c.Status != ContractStatus.Active || c.EndDate != e.EndDate || e.Stage != (c.EndDate < today ? "Expired" : "Upcoming30")) return [];
            return [new Intent(e.RecipientId, e.RecipientId == c.OwnerSignerId ? Roles.Owner : Roles.Tenant, c.Room.LocationId, "Contract", e.Stage == "Expired" ? "Hợp đồng đã đến hạn xử lý" : "Hợp đồng sắp hết hạn", "Vui lòng xem hợp đồng để thực hiện gia hạn hoặc trả phòng.", "Contract", c.Id)];
        }, t);
        var tasks = await db.Set<OperationalTaskNotification>().AsNoTracking().Where(e => !db.Set<NotificationPublication>().Any(p => p.EventKey == "task:" + e.Id.ToString())).OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in tasks) count += await Publish("task:" + e.Id, async () =>
        {
            var task = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(task => task.Id == e.TaskId, t); var role = await ActiveRole(e.RecipientUserId, Roles.Owner, t) ? Roles.Owner : Roles.Staff;
            if (role == Roles.Staff && (!await db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == e.RecipientUserId && a.LocationId == task.LocationId && a.StartDate <= BillingAutomationDates.BusinessDate(clock.GetUtcNow()) && a.EndDate >= BillingAutomationDates.BusinessDate(clock.GetUtcNow()), t) || task.AutomationPlanId != null && task.AssignedStaffUserId != e.RecipientUserId)) return [];
            return [new Intent(e.RecipientUserId, role, task.LocationId, "Task", task.Kind == OperationalTaskKind.MeterReading ? "Công việc ghi chỉ số định kỳ" : "Công việc có cập nhật", "Mở công việc để xem yêu cầu và thời hạn trong phạm vi được phân công.", task.Kind == OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, e.Id, e.ReadAt, EventType: e.Event switch { "assigned" or "assign" or "created" or "scheduled_meter_created" or "scheduled_meter_assigned" or "responsibility_changed" => "TASK_ASSIGNED", "submit" or "submitted" => "TASK_COMPLETION_SUBMITTED", "rework" => "TASK_REWORK_REQUIRED", _ => "TASK_UPDATED" })];
        }, t);
        var issues = await db.Set<BillingAutomationExecution>().AsNoTracking().Where(e => e.Status == "PendingInputs" && !db.Set<NotificationPublication>().Any(p => p.EventKey == "billing-exception:" + e.Id.ToString())).OrderBy(e => e.LastStartedAt).Take(25).ToArrayAsync(t);
        foreach (var e in issues) count += await Publish("billing-exception:" + e.Id, async () =>
        {
            var plan = await db.Set<BillingAutomationPlan>().AsNoTracking().SingleAsync(p => p.Id == e.PlanId, t);
            var list = new List<Intent> { new(plan.AuthorizedByUserId, Roles.Owner, e.LocationId, "Task", "Tự động hóa cần xử lý", $"Kỳ {e.BillingPeriod:MM/yyyy} còn thông tin cần bổ sung. Vui lòng xem nhật ký.", "AutomationExecution", e.Id) };
            var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
            foreach (var staff in await db.StaffLocationAssignments.Where(a => a.LocationId == e.LocationId && a.StartDate <= today && a.EndDate >= today).Select(a => a.StaffUserId).Distinct().ToArrayAsync(t))
                list.Add(new(staff, Roles.Staff, e.LocationId, "Task", "Kỳ hóa đơn còn thiếu dữ liệu", "Vui lòng kiểm tra công việc điện/nước được phân công và bổ sung dữ liệu đã xác nhận.", "Location", e.LocationId, EventType: "INVOICE_FINALIZATION_BLOCKED"));
            return list;
        }, t);
        return count + await PublishSettlementAsync(t) + (extended is null ? 0 : await extended.PublishAsync(t));
    }
}
