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
namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher(BHomePersistenceContext db, IBackgroundJobQueue queue, TimeProvider clock, CompactNotificationEvents? extended = null,
    Microsoft.Extensions.Options.IOptions<SmsOptions>? sms = null) : INotificationEventPublisher, IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-publish";
    public Task EnqueueDueAsync(CancellationToken t) => queue.EnqueueAsync(new(Name, clock.GetUtcNow().ToString("yyyyMMddHHmm"), "{}"), t);
    public async Task ExecuteAsync(JobExecution job, CancellationToken t) { await PublishPendingAsync(t); }
    private sealed record Intent(Guid Recipient, string Role, Guid? Location, string Category, string Title, string Summary, string Type, Guid ObjectId, Guid? TaskSource = null, DateTimeOffset? ReadAt = null, string EventType = "", string Priority = "P1", string[]? Channels = null);
    private Task<bool> ActiveRole(Guid id, string role, CancellationToken t) => (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id == id && u.IsActive && r.Name == role select u.Id).AnyAsync(t);
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
        foreach (var id in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).ToArrayAsync(t)) list.Add(new(id, Roles.Tenant, invoice.LocationId, category, title, summary, "Invoice", invoice.Id, Channels: category == "Invoice" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]));
        return list;
    }
    private async Task<List<Intent>> BlockedStaff(Guid location, Guid roomId, string roomNumber, DateOnly period, CancellationToken t)
    {
        var day = clock.BusinessToday();
        var assignments = db.StaffLocationAssignments.AsNoTracking().Where(a => a.LocationId == location && a.StartDate <= day && a.EndDate >= day);
        if (db is Compact24DbContext compact) assignments = assignments.Where(a => StaffEmploymentEligibility.EligibleIds(compact, day).Contains(a.StaffUserId));
        var ids = await assignments.Select(a => a.StaffUserId).Distinct().ToArrayAsync(t);
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
                if (await db.PeriodicInvoices().AnyAsync(i => i.RoomId == roomId && i.BillingPeriod == execution.BillingPeriod, t)) continue;
                count += await Publish(key, async () =>
                {
                    var room = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == roomId && r.LocationId == execution.LocationId, t);
                    if (room is null || await db.PeriodicInvoices().AnyAsync(i => i.RoomId == roomId && i.BillingPeriod == execution.BillingPeriod, t)) return [];
                    var current = await db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(e => e.Id == execution.Id, t);
                    if (current.Status != "PendingInputs" || !MissingDraftRooms(current.ExceptionsJson).Contains(roomId)) return [];
                    var plan = await db.Set<BillingAutomationPlan>().AsNoTracking().SingleAsync(p => p.Id == execution.PlanId, t);
                    var from = execution.BillingPeriod;
                    var to = from.AddMonths(1).AddDays(-1);
                    var contracts = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == roomId && c.ActivatedAt != null &&
                        (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                        c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from).ToArrayAsync(t);
                    var residentIds = contracts.SelectMany(c => c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from)).Select(r => r.ResidentId)).Distinct().ToArray();
                    var tenants = await db.Set<Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.TenantUserId != null).Select(r => r.TenantUserId!.Value).ToArrayAsync(t);
                    var summary = $"Hóa đơn phòng {room.RoomNumber} kỳ {from:MM/yyyy} chưa được tạo vì còn thiếu điều kiện. Hệ thống sẽ tiếp tục xử lý khi dữ liệu đầy đủ.";
                    var list = new List<Intent> { new(plan.AuthorizedByUserId, Roles.Owner, room.LocationId, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành", summary, "AutomationExecution", execution.Id, EventType: "INVOICE_FINALIZATION_BLOCKED") };
                    list.AddRange(tenants.Concat(contracts.Where(c => c.TenantUserId != null).Select(c => c.TenantUserId!.Value)).Distinct().Select(id => new Intent(id, Roles.Tenant, room.LocationId, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành", summary, "Room", roomId, EventType: "INVOICE_FINALIZATION_BLOCKED")));
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
        var invoices = await db.Set<InvoiceIssuedEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("invoice:" + e.InvoiceId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in invoices) count += await Publish("invoice:" + e.InvoiceId, async () =>
        {
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t);
            return i.Status != InvoiceStatus.Final ? [] : await InvoiceAudience(i, "Invoice", "Hóa đơn đã phát hành", $"Kỳ {i.BillingPeriod:MM/yyyy} đã có hóa đơn chính thức. Mở hóa đơn để xem nghĩa vụ hiện hành.", t, e.OwnerUserId);
        }, t);
        // Finalization rejects pending adjustments in both manual and scheduled modes.
        // A rejected transaction cannot persist an outbox event, so derive one
        // durable, deduplicated notification per due Draft from committed requests.
        // Never disclose another tenant's adjustment reason or evidence.
        var today = clock.BusinessToday();
        var held = await db.Set<InvoiceAdjustmentRequest>().AsNoTracking()
            .Where(r => r.Decision == null && r.Invoice.Status == InvoiceStatus.Draft &&
                r.Invoice.ScheduledFinalDate <= today &&
                !publicationKeys.Contains("invoice-finalization-held:" + r.InvoiceId.ToString()))
            .OrderBy(r => r.SubmittedAt).ThenBy(r => r.Id).Take(50).Select(r => new { r.Id, r.InvoiceId }).ToArrayAsync(t);
        foreach (var request in held.DistinctBy(r => r.InvoiceId))
            count += await Publish("invoice-finalization-held:" + request.InvoiceId, async () =>
            {
                var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == request.InvoiceId, t);
                if (invoice.Status != InvoiceStatus.Draft || invoice.ScheduledFinalDate > clock.BusinessToday() ||
                    !await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => r.InvoiceId == invoice.Id && r.Decision == null, t))
                    return [];
                var recipients = new List<Intent>
                {
                    new(invoice.CreatedByUserId, Roles.Owner, invoice.LocationId, "Adjustment",
                        "Cần xác nhận điều chỉnh trước khi phát hành",
                        $"Hóa đơn phòng {invoice.RoomNumber} kỳ {invoice.BillingPeriod:MM/yyyy} đang tạm dừng phát hành. Hãy xử lý tất cả yêu cầu điều chỉnh đang chờ để hệ thống tự phát hành khi đủ điều kiện.",
                        "Adjustment", request.Id, EventType: "INVOICE_FINALIZATION_BLOCKED", Channels: ["IN_APP", "PUSH", "EMAIL"])
                };
                foreach (var tenant in await db.Set<InvoiceRecipient>().AsNoTracking()
                    .Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).Distinct().ToArrayAsync(t))
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
        var finalExecutions = await db.Set<BillingAutomationExecution>().AsNoTracking().Where(e => e.Phase == "Final" && e.Status == "PendingInputs")
            .OrderBy(e => e.BillingPeriod).ThenBy(e => e.Id).ToArrayAsync(t);
        foreach (var execution in finalExecutions)
            foreach (var invoiceIds in BlockedInvoiceIds(execution.ExceptionsJson).Chunk(100))
            {
                var blockedDrafts = await db.Set<Invoice>().AsNoTracking().Where(i => invoiceIds.Contains(i.Id) &&
                    i.LocationId == execution.LocationId && i.BillingPeriod == execution.BillingPeriod && i.Status == InvoiceStatus.Draft &&
                    i.ScheduledFinalDate <= today && !db.Set<InvoiceAdjustmentRequest>().Any(r => r.InvoiceId == i.Id && r.Decision == null) &&
                    !publicationKeys.Contains("invoice-finalization-inputs:" + i.Id.ToString()))
                    .OrderBy(i => i.ScheduledFinalDate).ThenBy(i => i.Id).Select(i => i.Id).ToArrayAsync(t);
                foreach (var blockedId in blockedDrafts)
                    count += await Publish("invoice-finalization-inputs:" + blockedId, async () =>
                    {
                        var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == blockedId, t);
                        if (invoice.Status != InvoiceStatus.Draft || invoice.ScheduledFinalDate > clock.BusinessToday() ||
                            await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => r.InvoiceId == invoice.Id && r.Decision == null, t)) return [];
                        var audience = await InvoiceAudience(invoice, "Invoice", "Hóa đơn chưa đủ điều kiện phát hành",
                            $"Hóa đơn phòng {invoice.RoomNumber} kỳ {invoice.BillingPeriod:MM/yyyy} đang chờ bổ sung hoặc xác minh dữ liệu. Hệ thống sẽ tự phát hành khi đủ điều kiện.", t);
                        audience.AddRange(await BlockedStaff(invoice.LocationId, invoice.RoomId, invoice.RoomNumber, invoice.BillingPeriod, t));
                        return audience.Select(n => n with { EventType = "INVOICE_FINALIZATION_BLOCKED" }).ToArray();
                    }, t);
            }
        count += await PublishMissingDrafts(finalExecutions, t);
        var payments = await db.Set<PaymentConfirmedEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("payment:" + e.AllocationId.ToString())).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in payments) count += await Publish("payment:" + e.AllocationId, async () =>
        {
            var allocation = await db.Set<PaymentAllocation>().AsNoTracking().SingleAsync(a => a.Id == e.AllocationId && a.InvoiceId == e.InvoiceId, t);
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t);
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
        var adjustments = await db.Set<InvoiceAdjustmentEvent>().AsNoTracking().Where(e => !publicationKeys.Contains("adjustment:" + e.RequestId.ToString() + ":" + e.Name)).OrderBy(e => e.OccurredAt).Take(25).ToArrayAsync(t);
        foreach (var e in adjustments) count += await Publish("adjustment:" + e.RequestId + ":" + e.Name, async () =>
        {
            var i = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == e.InvoiceId, t); var list = new List<Intent>();
            if (e.Name == "invoice.adjustment.requested.v1")
            {
                list.Add(new(i.FinalizedByUserId ?? i.CreatedByUserId, Roles.Owner, i.LocationId, "Adjustment", "Có yêu cầu điều chỉnh hóa đơn", $"Kỳ {i.BillingPeriod:MM/yyyy} có yêu cầu cần chủ trọ xem xét.", "Adjustment", e.RequestId));
                foreach (var id in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == i.Id).Select(r => r.TenantUserId).ToArrayAsync(t))
                    list.Add(new(id, Roles.Tenant, i.LocationId, "Adjustment", "Có yêu cầu điều chỉnh hóa đơn", $"Hóa đơn kỳ {i.BillingPeriod:MM/yyyy} có yêu cầu điều chỉnh đang chờ phản hồi.", "Invoice", i.Id));
            }
            else if (e.Name == "invoice.adjustment.decided.v1")
            {
                var decision = await db.Set<InvoiceAdjustmentDecision>().AsNoTracking().SingleAsync(d => d.RequestId == e.RequestId, t); var approved = decision.Outcome == "Approved";
                list.Add(new(e.RequesterId, Roles.Tenant, i.LocationId, "Adjustment", approved ? "Yêu cầu điều chỉnh đã được duyệt" : "Yêu cầu điều chỉnh đã bị từ chối", "Mở yêu cầu của bạn để xem kết quả được phép truy cập.", "Adjustment", e.RequestId));
                foreach (var id in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == i.Id && r.TenantUserId != e.RequesterId).Select(r => r.TenantUserId).ToArrayAsync(t)) list.Add(new(id, Roles.Tenant, i.LocationId, "Adjustment", "Yêu cầu điều chỉnh đã được phản hồi", $"Vui lòng xem trạng thái hiện hành của hóa đơn kỳ {i.BillingPeriod:MM/yyyy}.", "Invoice", i.Id));
            }
            return list;
        }, t);
        var expiries = billingOnly || extended is not null ? [] : await db.Set<ContractExpiryNotice>().AsNoTracking().Where(e => !publicationKeys.Contains("contract-expiry:" + e.Id.ToString())).OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in expiries) count += await Publish("contract-expiry:" + e.Id, async () =>
        {
            var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleAsync(c => c.Id == e.ContractId, t); var expiryToday = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
            if (c.Status != ContractStatus.Active || c.EndDate != e.EndDate || e.Stage != (c.EndDate < expiryToday ? "Expired" : "Upcoming30")) return [];
            return [new Intent(e.RecipientId, e.RecipientId == c.OwnerSignerId ? Roles.Owner : Roles.Tenant, c.Room.LocationId, "Contract", e.Stage == "Expired" ? "Hợp đồng đã đến hạn xử lý" : "Hợp đồng sắp hết hạn", "Vui lòng xem hợp đồng để thực hiện gia hạn hoặc trả phòng.", "Contract", c.Id)];
        }, t);
        var tasks = await db.Set<OperationalTaskNotification>().AsNoTracking().Where(e => !publicationKeys.Contains("task:" + e.Id.ToString()) &&
            (!billingOnly || db.Set<OperationalTask>().Any(task => task.Id == e.TaskId && task.Kind == OperationalTaskKind.MeterReading && task.BillingPeriod != null)))
            .OrderBy(e => e.CreatedAt).Take(25).ToArrayAsync(t);
        foreach (var e in tasks)
        {
            var task = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(task => task.Id == e.TaskId, t);
            var role = await ActiveRole(e.RecipientUserId, Roles.Owner, t) ? Roles.Owner : Roles.Staff;
            if (role == Roles.Staff && task.Kind == OperationalTaskKind.MeterReading &&
                task.Purpose == ReadingPurpose.Periodic && task.BillingPeriod is { } period &&
                e.Event is "assigned" or "assign" or "created" or "scheduled_meter_created" or "scheduled_meter_assigned" or "responsibility_changed")
            {
                var key = $"periodic-meter-assigned:{e.RecipientUserId:N}:{task.LocationId:N}:{period:yyyyMM}";
                if (task.Status != MeterTaskStatus.Completed && task.Status != MeterTaskStatus.Cancelled &&
                    await db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == e.RecipientUserId && a.LocationId == task.LocationId && a.StartDate <= today && a.EndDate >= today, t) &&
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
                if (role == Roles.Staff && (!await db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == e.RecipientUserId && a.LocationId == task.LocationId && a.StartDate <= assignmentDate && a.EndDate >= assignmentDate, t) || task.Purpose != ReadingPurpose.Periodic && task.AutomationPlanId != null && task.AssignedStaffUserId != e.RecipientUserId)) return [];
                return [new Intent(e.RecipientUserId, role, task.LocationId, "Task", task.Kind == OperationalTaskKind.MeterReading ? "Công việc ghi chỉ số định kỳ" : "Công việc có cập nhật", "Mở công việc để xem yêu cầu và thời hạn trong phạm vi được phân công.", task.Kind == OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, e.Id, e.ReadAt, EventType: e.Event switch { "assigned" or "assign" or "created" or "scheduled_meter_created" or "scheduled_meter_assigned" or "responsibility_changed" => "TASK_ASSIGNED", "submit" or "submitted" => "TASK_COMPLETION_SUBMITTED", "rework" => "TASK_REWORK_REQUIRED", _ => "TASK_UPDATED" })];
            }, t);
        }
        var issues = await db.Set<BillingAutomationExecution>().AsNoTracking().Where(e => e.Phase != "Final" && e.Status == "PendingInputs" && !publicationKeys.Contains("billing-exception:" + e.Id.ToString())).OrderBy(e => e.LastStartedAt).Take(25).ToArrayAsync(t);
        foreach (var e in issues) count += await Publish("billing-exception:" + e.Id, async () =>
        {
            var plan = await db.Set<BillingAutomationPlan>().AsNoTracking().SingleAsync(p => p.Id == e.PlanId, t);
            var list = new List<Intent> { new(plan.AuthorizedByUserId, Roles.Owner, e.LocationId, "Task", "Tự động hóa cần xử lý", $"Kỳ {e.BillingPeriod:MM/yyyy} còn thông tin cần bổ sung. Vui lòng xem nhật ký.", "AutomationExecution", e.Id) };
            return list;
        }, t);
        if (billingOnly) return count + (extended is null ? 0 : await extended.PublishBillingAsync(t));
        return count + await PublishSettlementAsync(t) + await PublishReceiptRefundsAsync(t) + (extended is null ? 0 : await extended.PublishAsync(t));
    }
}
