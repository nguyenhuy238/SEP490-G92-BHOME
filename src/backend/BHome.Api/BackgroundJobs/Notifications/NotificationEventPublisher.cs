using BHome.Application.Billing;
using BHome.Application.Common;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using Native = BHome.Domain.Entities;
namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher(BHomePersistenceContext db, IBackgroundJobQueue queue, TimeProvider clock, CompactNotificationEvents? extended = null,
    Microsoft.Extensions.Options.IOptions<SmsOptions>? sms = null) : INotificationEventPublisher, IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-publish";
    public Task EnqueueDueAsync(CancellationToken t) => queue.EnqueueAsync(new(Name, clock.GetUtcNow().ToString("yyyyMMddHHmm"), "{}"), t);
    public async Task ExecuteAsync(JobExecution job, CancellationToken t) { await PublishPendingAsync(t); }
    private sealed record Intent(Guid Recipient, string Role, Guid? Location, string Category, string Title, string Summary, string Type, Guid ObjectId, Guid? TaskSource = null, DateTimeOffset? ReadAt = null, string EventType = "", string Priority = "P1", string[]? Channels = null);
    private Task<bool> ActiveRole(Guid id, string role, CancellationToken t) => db is Compact24DbContext compact
        ? NativeBillingAutomationPersistence.ActiveRoleAsync(compact, id, role, t)
        : (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id == id && u.IsActive && r.Name == role select u.Id).AnyAsync(t);
    private async Task<int> Publish(string key, Func<Task<IReadOnlyList<Intent>>> resolve, CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"notification:" + key},0))", t);
        if (await NotificationPublications.Keys(db).ContainsAsync(key, t)) return 0;
        var count = 0; var recipients = 0;
        foreach (var sourceIntent in (await resolve()).DistinctBy(i => i.Recipient))
        {
            var i = sourceIntent;
            if (sms?.Value.Enabled == true && SmsNotificationPolicy.Template(i.EventType.Length > 0 ? i.EventType : EventType(key), i.Role) is { } template && sms.Value.EnabledTemplates.Contains(template))
                i = i with { Channels = (i.Channels ?? ["IN_APP", "PUSH"]).Append("SMS").Distinct().ToArray() };
            if (!await ActiveRole(i.Recipient, i.Role, t)) continue; recipients++;
            if (await NotificationInboxWrites.ExistsAsync(db, i.Recipient, key, t)) continue;
            NotificationInboxWrites.Add(db, new NotificationInboxState
            {
                Id = Guid.NewGuid(),
                RecipientUserId = i.Recipient,
                AudienceRole = i.Role,
                LocationId = i.Location,
                Category = i.Category,
                Title = i.Title,
                Summary = i.Summary,
                RelatedObjectType = i.Type,
                RelatedObjectId = i.ObjectId,
                EventKey = key,
                EventType = i.EventType.Length > 0 ? i.EventType : EventType(key),
                Priority = i.Priority,
                Channels = NotificationEmailPolicy.Channels(i.EventType.Length > 0 ? i.EventType : EventType(key), i.Role, i.Channels ?? ["IN_APP", "PUSH"]),
                SourceTaskNotificationId = i.TaskSource,
                CreatedAt = clock.GetUtcNow(),
                ReadAt = i.ReadAt,
                DeliveryState = "Unconfigured"
            });
            count++;
        }
        await NotificationPublications.SaveAsync(db, key, clock.GetUtcNow(), recipients, t); await tx.CommitAsync(t); return count;
    }
    private static string EventType(string key) => key.Split(':')[0] switch
    {
        "invoice" => "INVOICE_FINALIZED",
        "adjustment" => key.Contains("requested") ? "INVOICE_ADJUSTMENT_REQUESTED" : "INVOICE_ADJUSTMENT_DECIDED",
        "contract-expiry" => "CONTRACT_EXPIRY_REMINDER",
        "task" => "TASK_UPDATED",
        "billing-exception" => "TASK_UPDATED",
        "move-out" => "MOVE_OUT_STATUS_CHANGED",
        _ => "CONTRACT_STATUS_CHANGED"
    };
    private async Task<List<Intent>> InvoiceAudience(Invoice invoice, string category, string title, string summary, CancellationToken t, Guid? extraOwner = null)
    {
        var list = new List<Intent>();
        foreach (var owner in new[] { invoice.FinalizedByUserId ?? invoice.CreatedByUserId, extraOwner ?? Guid.Empty }.Where(id => id != Guid.Empty).Distinct()) list.Add(new(owner, Roles.Owner, invoice.LocationId, category, title, summary, "Invoice", invoice.Id, Channels: category == "Invoice" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]));
        foreach (var id in await RecipientIds(invoice.Id, t)) list.Add(new(id, Roles.Tenant, invoice.LocationId, category, title, summary, "Invoice", invoice.Id, Channels: category == "Invoice" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]));
        return list;
    }
    private async Task<List<Intent>> BlockedStaff(Guid location, Guid roomId, string roomNumber, DateOnly period, CancellationToken t)
    {
        var day = clock.BusinessToday();
        var ids = db is Compact24DbContext compact
            ? await NativeOperationalTaskPersistence.Assignments(compact, day).Where(a => a.LocationId == location).Select(a => a.StaffUserId).Distinct().ToArrayAsync(t)
            : await db.StaffLocationAssignments.AsNoTracking().Where(a => a.LocationId == location && a.StartDate <= day && a.EndDate >= day).Select(a => a.StaffUserId).Distinct().ToArrayAsync(t);
        return ids.Select(id => new Intent(id, Roles.Staff, location, "Task", "Kỳ hóa đơn còn thiếu dữ liệu",
            $"Phòng {roomNumber} kỳ {period:MM/yyyy} chưa đủ điều kiện phát hành. Kiểm tra công việc được phân công nếu cần bổ sung dữ liệu.",
            "Location", location, EventType: "INVOICE_FINALIZATION_BLOCKED", Channels: ["IN_APP"])).ToList();
    }
    private static Guid[] MissingDraftRooms(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        return doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object && e.TryGetProperty("code", out var code) &&
            code.ValueKind == JsonValueKind.String && code.GetString() == "draft_invoice_required" &&
            e.TryGetProperty("roomId", out var id) && id.ValueKind == JsonValueKind.String && id.TryGetGuid(out _)).Select(e => e.GetProperty("roomId").GetGuid()).Distinct().ToArray();
    }
    private static Guid[] BlockedInvoiceIds(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        return doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object && e.TryGetProperty("invoiceId", out var id) &&
            id.ValueKind == JsonValueKind.String && id.TryGetGuid(out _)).Select(e => e.GetProperty("invoiceId").GetGuid()).Distinct().ToArray();
    }
    private async Task<int> PublishMissingDrafts(IReadOnlyList<BillingAutomationExecution> executions, CancellationToken t)
    {
        var count = 0;
        foreach (var execution in executions)
            foreach (var roomId in MissingDraftRooms(execution.ExceptionsJson))
            {
                var key = $"invoice-finalization-no-draft:{roomId:D}:{execution.BillingPeriod:yyyyMM}";
                if (await NotificationPublications.Keys(db).ContainsAsync(key, t)) continue;
                if (await HasPeriodicInvoice(roomId, execution.BillingPeriod, t)) continue;
                count += await Publish(key, async () =>
                {
                    var room = await LoadRoom(roomId, execution.LocationId, t);
                    if (room is null || await HasPeriodicInvoice(roomId, execution.BillingPeriod, t)) return [];
                    var current = await LoadExecution(execution.Id, t);
                    if (current.Status != "PendingInputs" || !MissingDraftRooms(current.ExceptionsJson).Contains(roomId)) return [];
                    var plan = await LoadPlan(execution.PlanId, t);
                    var from = execution.BillingPeriod;
                    var to = from.AddMonths(1).AddDays(-1);
                    var tenants = await MissingDraftTenants(roomId, from, to, t);
                    var summary = $"Hóa đơn phòng {room.RoomNumber} kỳ {from:MM/yyyy} chưa được tạo vì còn thiếu điều kiện. Hệ thống sẽ tiếp tục xử lý khi dữ liệu đầy đủ.";
                    var list = new List<Intent> { new(plan.AuthorizedByUserId, Roles.Owner, room.LocationId, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành", summary, "AutomationExecution", execution.Id, EventType: "INVOICE_FINALIZATION_BLOCKED") };
                    list.AddRange(tenants.Select(id => new Intent(id, Roles.Tenant, room.LocationId, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành", summary, "Room", roomId, EventType: "INVOICE_FINALIZATION_BLOCKED")));
                    list.AddRange(await BlockedStaff(room.LocationId, roomId, room.RoomNumber, from, t));
                    return list;
                }, t);
            }
        return count;
    }
    public Task<int> PublishPendingAsync(CancellationToken t) => PublishPendingAsync(t, false);
    internal Task<int> PublishBillingPendingAsync(CancellationToken t) => PublishPendingAsync(t, true);
    private async Task<int> PublishPendingAsync(CancellationToken t, bool billingOnly)
    {
        var count = 0;
        var publicationKeys = NotificationPublications.Keys(db);
        var invoices = db is Compact24DbContext issuedDb
            ? await ReadOutbox<InvoiceIssuedEvent>(Outbox(issuedDb, "InvoiceIssuedEvent").Where(n => !publicationKeys.Contains("invoice:" + n.EventData.GetProperty("state").GetProperty("invoiceId").GetString())), t)
            : await db.Set<InvoiceIssuedEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("invoice:" + e.InvoiceId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in invoices) count += await Publish("invoice:" + e.InvoiceId, async () =>
        {
            var i = await LoadInvoice(e.InvoiceId, t);
            return i.Status != InvoiceStatus.Final ? [] : await InvoiceAudience(i, "Invoice", "Hóa đơn đã phát hành", $"Kỳ {i.BillingPeriod:MM/yyyy} đã có hóa đơn chính thức. Mở hóa đơn để xem nghĩa vụ hiện hành.", t, e.OwnerUserId);
        }, t);
        // Finalization rejects pending adjustments in both manual and scheduled modes.
        // A rejected transaction cannot persist an outbox event, so derive one
        // durable, deduplicated notification per due Draft from committed requests.
        // Never disclose another tenant's adjustment reason or evidence.
        var today = clock.BusinessToday();
        var held = db is Compact24DbContext heldDb
            ? await (from r in heldDb.Set<InvoiceAdjustmentRequest>().AsNoTracking()
                     join i in heldDb.Set<BHome.Domain.Billing.Invoice>() on r.InvoiceId equals i.Id
                     where r.DecisionSnapshot == null && i.Status == InvoiceStatus.Draft && i.ScheduledFinalDate <= today &&
                        !publicationKeys.Contains("invoice-finalization-held:" + r.InvoiceId.ToString())
                     orderby r.SubmittedAt, r.Id
                     select new { r.Id, r.InvoiceId }).Take(50).ToArrayAsync(t)
            : await db.Set<InvoiceAdjustmentRequest>().AsNoTracking()
            .Where(r => r.Decision == null && r.Invoice.Status == InvoiceStatus.Draft &&
                r.Invoice.ScheduledFinalDate <= today &&
                !publicationKeys.Contains("invoice-finalization-held:" + r.InvoiceId.ToString()))
            .OrderBy(r => r.SubmittedAt).ThenBy(r => r.Id).Take(50).Select(r => new { r.Id, r.InvoiceId }).ToArrayAsync(t);
        foreach (var request in held.DistinctBy(r => r.InvoiceId))
            count += await Publish("invoice-finalization-held:" + request.InvoiceId, async () =>
            {
                var invoice = await LoadInvoice(request.InvoiceId, t);
                if (invoice.Status != InvoiceStatus.Draft || invoice.ScheduledFinalDate > clock.BusinessToday() ||
                    !await PendingAdjustment(invoice.Id, t))
                    return [];
                var recipients = new List<Intent>
                {
                    new(invoice.CreatedByUserId, Roles.Owner, invoice.LocationId, "Adjustment",
                        "Cần xác nhận điều chỉnh trước khi phát hành",
                        $"Hóa đơn phòng {invoice.RoomNumber} kỳ {invoice.BillingPeriod:MM/yyyy} đang tạm dừng phát hành. Hãy xử lý tất cả yêu cầu điều chỉnh đang chờ để hệ thống tự phát hành khi đủ điều kiện.",
                        "Adjustment", request.Id, EventType: "INVOICE_FINALIZATION_BLOCKED", Channels: ["IN_APP", "PUSH", "EMAIL"])
                };
                foreach (var tenant in (await RecipientIds(invoice.Id, t)).Distinct())
                    recipients.Add(new(tenant, Roles.Tenant, invoice.LocationId, "Invoice",
                        "Hóa đơn đang chờ xử lý điều chỉnh",
                        $"Hóa đơn phòng {invoice.RoomNumber} kỳ {invoice.BillingPeriod:MM/yyyy} chưa được phát hành vì còn yêu cầu cần Owner xem xét. Bạn có thể theo dõi trạng thái trong ứng dụng.",
                        "Invoice", invoice.Id, EventType: "INVOICE_FINALIZATION_BLOCKED", Channels: ["IN_APP", "PUSH", "EMAIL"]));
                recipients.AddRange(await BlockedStaff(invoice.LocationId, invoice.RoomId, invoice.RoomNumber, invoice.BillingPeriod, t));
                return recipients;
            }, t);
        // Unlike a location-wide execution warning, this event refers to a specific
        // Draft and is visible only to its invoice recipients and authorized Owner.
        // ExceptionsJson is mapped to jsonb; parse the exact fields after materialization.
        // Process every pending execution and chunk its IDs, rather than taking an arbitrary
        // prefix of drafts before the JSON filter (which can starve later blocked drafts).
        var finalExecutions = await PendingExecutions(true, t);
        foreach (var execution in finalExecutions)
            foreach (var invoiceIds in BlockedInvoiceIds(execution.ExceptionsJson).Chunk(100))
            {
                var blockedDrafts = db is Compact24DbContext blockedDb
                    ? await blockedDb.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => invoiceIds.Contains(i.Id) &&
                        i.LocationId == execution.LocationId && i.BillingPeriod == execution.BillingPeriod && i.Status == InvoiceStatus.Draft &&
                        i.ScheduledFinalDate <= today && !blockedDb.Set<InvoiceAdjustmentRequest>().Any(r => r.InvoiceId == i.Id && r.DecisionSnapshot == null) &&
                        !publicationKeys.Contains("invoice-finalization-inputs:" + i.Id.ToString()))
                        .OrderBy(i => i.ScheduledFinalDate).ThenBy(i => i.Id).Select(i => i.Id).ToArrayAsync(t)
                    : await db.Set<Invoice>().AsNoTracking().Where(i => invoiceIds.Contains(i.Id) &&
                    i.LocationId == execution.LocationId && i.BillingPeriod == execution.BillingPeriod && i.Status == InvoiceStatus.Draft &&
                    i.ScheduledFinalDate <= today && !db.Set<InvoiceAdjustmentRequest>().Any(r => r.InvoiceId == i.Id && r.Decision == null) &&
                    !publicationKeys.Contains("invoice-finalization-inputs:" + i.Id.ToString()))
                    .OrderBy(i => i.ScheduledFinalDate).ThenBy(i => i.Id).Select(i => i.Id).ToArrayAsync(t);
                foreach (var blockedId in blockedDrafts)
                    count += await Publish("invoice-finalization-inputs:" + blockedId, async () =>
                    {
                        var invoice = await LoadInvoice(blockedId, t);
                        if (invoice.Status != InvoiceStatus.Draft || invoice.ScheduledFinalDate > clock.BusinessToday() ||
                            await PendingAdjustment(invoice.Id, t)) return [];
                        var audience = await InvoiceAudience(invoice, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành",
                            $"Hóa đơn phòng {invoice.RoomNumber} kỳ {invoice.BillingPeriod:MM/yyyy} đang chờ bổ sung hoặc xác minh dữ liệu. Hệ thống sẽ tự phát hành khi đủ điều kiện.", t);
                        audience.AddRange(await BlockedStaff(invoice.LocationId, invoice.RoomId, invoice.RoomNumber, invoice.BillingPeriod, t));
                        return audience.Select(n => n with { EventType = "INVOICE_FINALIZATION_BLOCKED" }).ToArray();
                    }, t);
            }
        count += await PublishMissingDrafts(finalExecutions, t);
        var payments = db is Compact24DbContext paidDb
            ? await ReadOutbox<PaymentConfirmedEvent>(Outbox(paidDb, "PaymentConfirmedEvent").Where(n => !publicationKeys.Contains("payment:" + n.EventData.GetProperty("state").GetProperty("allocationId").GetString())), t)
            : await db.Set<PaymentConfirmedEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("payment:" + e.AllocationId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in payments) count += await Publish("payment:" + e.AllocationId, async () =>
        {
            var allocation = db is Compact24DbContext allocationDb
                ? await allocationDb.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking().Where(a => a.Id == e.AllocationId && a.InvoiceId == e.InvoiceId).Select(a => new { a.Amount, VerifiedByUserId = a.CreatedByUserId ?? Guid.Empty }).SingleAsync(t)
                : await db.Set<PaymentAllocation>().AsNoTracking().Where(a => a.Id == e.AllocationId && a.InvoiceId == e.InvoiceId).Select(a => new { a.Amount, a.VerifiedByUserId }).SingleAsync(t);
            var i = await LoadInvoice(e.InvoiceId, t);
            if (i.Status != InvoiceStatus.Final) return [];
            var balance = await BHome.Infrastructure.Billing.InvoiceFinancialQueries.FinancialsAsync(db, i.Id, t);
            var outstanding = e.OutstandingAmount ?? balance.OutstandingAmount;
            var paid = e.PaidAmount ?? balance.AllocatedPayments;
            var full = outstanding == 0;
            if (full && await NotificationInboxWrites.HasEventAsync(db, i.Id, "INVOICE_FULLY_PAID", t)) return [];
            var notices = await InvoiceAudience(i, "Payment", full ? "Hóa đơn đã thanh toán đủ" : "Đã xác nhận thanh toán một phần",
                $"Hóa đơn phòng {i.RoomNumber} kỳ {i.BillingPeriod:MM/yyyy}: vừa ghi nhận {allocation.Amount:N0} VND; tổng đã thanh toán {paid:N0} VND; còn phải trả {outstanding:N0} VND.", t, allocation.VerifiedByUserId);
            return notices.Select(n => n with { EventType = full ? "INVOICE_FULLY_PAID" : "PAYMENT_PARTIALLY_CONFIRMED", Channels = ["IN_APP", "PUSH", "EMAIL"] }).ToArray();
        }, t);
        var adjustments = db is Compact24DbContext adjustmentDb
            ? await ReadOutbox<InvoiceAdjustmentEvent>(Outbox(adjustmentDb, "InvoiceAdjustmentEvent").Where(n => !publicationKeys.Contains("adjustment:" + n.EventData.GetProperty("state").GetProperty("requestId").GetString() + ":" + n.EventData.GetProperty("state").GetProperty("name").GetString())), t)
            : await db.Set<InvoiceAdjustmentEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("adjustment:" + e.RequestId.ToString() + ":" + e.Name)).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in adjustments) count += await Publish("adjustment:" + e.RequestId + ":" + e.Name, async () =>
        {
            var i = await LoadInvoice(e.InvoiceId, t); var list = new List<Intent>();
            if (e.Name == "invoice.adjustment.requested.v1")
            {
                list.Add(new(i.FinalizedByUserId ?? i.CreatedByUserId, Roles.Owner, i.LocationId, "Adjustment", "Có yêu cầu điều chỉnh hóa đơn", $"Kỳ {i.BillingPeriod:MM/yyyy} có yêu cầu cần chủ trọ xem xét.", "Adjustment", e.RequestId));
                foreach (var id in await RecipientIds(i.Id, t))
                    list.Add(new(id, Roles.Tenant, i.LocationId, "Adjustment", "Có yêu cầu điều chỉnh hóa đơn", $"Hóa đơn kỳ {i.BillingPeriod:MM/yyyy} có yêu cầu điều chỉnh đang chờ phản hồi.", "Invoice", i.Id));
            }
            else if (e.Name == "invoice.adjustment.decided.v1")
            {
                var decision = db is Compact24DbContext decisionDb
                    ? NativeAdjustmentPersistence.ReadDecision(await decisionDb.Set<InvoiceAdjustmentRequest>().AsNoTracking().SingleAsync(r => r.Id == e.RequestId, t)) ?? throw new InvalidOperationException("Notification adjustment decision missing.")
                    : await db.Set<InvoiceAdjustmentDecision>().AsNoTracking().SingleAsync(d => d.RequestId == e.RequestId, t);
                var approved = decision.Outcome == "Approved";
                list.Add(new(e.RequesterId, Roles.Tenant, i.LocationId, "Adjustment", approved ? "Yêu cầu điều chỉnh đã được duyệt" : "Yêu cầu điều chỉnh đã bị từ chối", "Mở yêu cầu của bạn để xem kết quả được phép truy cập.", "Adjustment", e.RequestId));
                foreach (var id in (await RecipientIds(i.Id, t)).Where(id => id != e.RequesterId)) list.Add(new(id, Roles.Tenant, i.LocationId, "Adjustment", "Yêu cầu điều chỉnh đã được phản hồi", $"Vui lòng xem trạng thái hiện hành của hóa đơn kỳ {i.BillingPeriod:MM/yyyy}.", "Invoice", i.Id));
            }
            return list;
        }, t);
        ContractExpiryNotice[] expiries = billingOnly || extended is not null ? [] : db is Compact24DbContext expiryDb
            ? await ReadOutbox<ContractExpiryNotice>(Outbox(expiryDb, "ContractExpiryNotice").Where(n => !publicationKeys.Contains("contract-expiry:" + n.EventData.GetProperty("state").GetProperty("id").GetString())), t)
            : await db.Set<ContractExpiryNotice>().AsNoTracking().Where(e => !publicationKeys.Contains("contract-expiry:" + e.Id.ToString())).OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in expiries) count += await Publish("contract-expiry:" + e.Id, async () =>
        {
            var c = await LoadNotificationContract(e.ContractId, t) ?? throw new InvalidOperationException("Notification contract missing."); var expiryToday = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
            if (c.Status != ContractStatus.Active || c.EndDate != e.EndDate || e.Stage != (c.EndDate < expiryToday ? "Expired" : "Upcoming30")) return [];
            return [new Intent(e.RecipientId, e.RecipientId == c.OwnerSignerId ? Roles.Owner : Roles.Tenant, c.Room.LocationId, "Contract", e.Stage == "Expired" ? "Hợp đồng đã đến hạn xử lý" : "Hợp đồng sắp hết hạn", "Vui lòng xem hợp đồng để thực hiện gia hạn hoặc trả phòng.", "Contract", c.Id)];
        }, t);
        var tasks = db is Compact24DbContext taskDb
            ? (await Outbox(taskDb, "OperationalTaskNotification").Where(n => !publicationKeys.Contains("task:" + n.Id.ToString()) &&
                (!billingOnly || taskDb.Set<BHome.Domain.Billing.OperationalTask>().Any(task => task.Id.ToString() == n.EventData.GetProperty("state").GetProperty("taskId").GetString() && task.TaskType == "METER_READ" && task.BillingPeriod != null)))
                .OrderBy(n => n.EventAt).Take(25).ToArrayAsync(t)).Select(NativeOperationalTaskPersistence.Notice).ToArray()
            : await db.Set<OperationalTaskNotification>().AsNoTracking().Where(e => !publicationKeys.Contains("task:" + e.Id.ToString()) &&
            (!billingOnly || db.Set<OperationalTask>().Any(task => task.Id == e.TaskId && task.Kind == OperationalTaskKind.MeterReading && task.BillingPeriod != null)))
            .OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in tasks)
        {
            var task = db is Compact24DbContext taskReadDb
                ? await NativeOperationalTaskPersistence.FindAsync(taskReadDb, e.TaskId, t) ?? throw new InvalidOperationException("Notification task missing.")
                : await db.Set<OperationalTask>().AsNoTracking().SingleAsync(task => task.Id == e.TaskId, t);
            var role = await ActiveRole(e.RecipientUserId, Roles.Owner, t) ? Roles.Owner : Roles.Staff;
            if (role == Roles.Staff && task.Kind == OperationalTaskKind.MeterReading &&
                task.Purpose == ReadingPurpose.Periodic && task.BillingPeriod is { } period &&
                e.Event is "assigned" or "assign" or "created" or "scheduled_meter_created" or "scheduled_meter_assigned" or "responsibility_changed")
            {
                var key = $"periodic-meter-assigned:{e.RecipientUserId:N}:{task.LocationId:N}:{period:yyyyMM}";
                if (task.Status != MeterTaskStatus.Completed && task.Status != MeterTaskStatus.Cancelled &&
                    await HasAssignment(e.RecipientUserId, task.LocationId, today, t) &&
                    (db is not Compact24DbContext compact || await StaffEmploymentEligibility.IsEligibleAsync(compact, e.RecipientUserId, today, t)))
                    count += await Publish(key, () => Task.FromResult<IReadOnlyList<Intent>>([
                        new(e.RecipientUserId, role, task.LocationId, "Task", $"Có nhiệm vụ ghi chỉ số kỳ {period:MM/yyyy}",
                            "Mở danh sách phòng được phân công để ghi chỉ số điện nước.", "MeterTask", task.Id, EventType: "TASK_ASSIGNED")
                    ]), t);
                // Consume each original outbox event, retaining its publication audit.
                await Publish("task:" + e.Id, () => Task.FromResult<IReadOnlyList<Intent>>([]), t);
                continue;
            }
            count += await Publish("task:" + e.Id, async () =>
            {
                var assignmentDate = task.AutomationPlanId is not null ? clock.BusinessToday() : BillingAutomationDates.BusinessDate(clock.GetUtcNow());
                if (role == Roles.Staff && (!await HasAssignment(e.RecipientUserId, task.LocationId, assignmentDate, t) || task.Purpose != ReadingPurpose.Periodic && task.AutomationPlanId != null && task.AssignedStaffUserId != e.RecipientUserId)) return [];
                return [new Intent(e.RecipientUserId, role, task.LocationId, "Task", task.Kind == OperationalTaskKind.MeterReading ? "Công việc ghi chỉ số định kỳ" : "Công việc có cập nhật", "Mở công việc để xem yêu cầu và thời hạn trong phạm vi được phân công.", task.Kind == OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, e.Id, e.ReadAt, EventType: e.Event switch { "assigned" or "assign" or "created" or "scheduled_meter_created" or "scheduled_meter_assigned" or "responsibility_changed" => "TASK_ASSIGNED", "submit" or "submitted" => "TASK_COMPLETION_SUBMITTED", "rework" => "TASK_REWORK_REQUIRED", _ => "TASK_UPDATED" })];
            }, t);
        }
        var issues = await PendingExecutions(false, t);
        foreach (var e in issues) count += await Publish("billing-exception:" + e.Id, async () =>
        {
            var plan = await LoadPlan(e.PlanId, t);
            var list = new List<Intent> { new(plan.AuthorizedByUserId, Roles.Owner, e.LocationId, "Task", "Tự động hóa cần xử lý", $"Kỳ {e.BillingPeriod:MM/yyyy} còn thông tin cần bổ sung. Vui lòng xem nhật ký.", "AutomationExecution", e.Id) };
            return list;
        }, t);
        if (billingOnly) return count + (extended is null ? 0 : await extended.PublishBillingAsync(t));
        return count + await PublishSettlementAsync(t) + await PublishReceiptRefundsAsync(t) + (extended is null ? 0 : await extended.PublishAsync(t));
    }
}
