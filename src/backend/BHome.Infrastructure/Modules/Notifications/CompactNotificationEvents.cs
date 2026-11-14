using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

// Consumes durable audit/domain intents already committed with their business transaction.
internal sealed partial class CompactNotificationEvents(Compact24DbContext db, CompactNotificationWriter sql)
{
    private DateOnly Today => BillingAutomationDates.BusinessDate(sql.Now);
    private Task<bool> Done(string key, CancellationToken t) => db.Set<NotificationPublication>().AnyAsync(p => p.EventKey == key, t);
    private async Task Mark(string key, CancellationToken t)
    { db.Add(new NotificationPublication { EventKey = key, PublishedAt = sql.Now }); await db.SaveChangesAsync(t); }
    internal async Task<int> PublishAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        var count = await Audits(t) + await AccountLockouts(t) + await Incidents(t) + await MeterReadings(t) + await Reminders(t) + await Unmatched(t) + await OperationalAlerts(t);
        await tx.CommitAsync(t); return count;
    }
    private async Task<List<(Guid Id, string Role)>> Roles(IEnumerable<Guid> ids, CancellationToken t)
    {
        var result = new List<(Guid, string)>();
        await using var cmd = await sql.Command("SELECT id,roles FROM users WHERE id=ANY(@ids)", t, ("ids", ids.Distinct().ToArray()));
        await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t))
        { var roles = reader.GetFieldValue<string[]>(1); var role = roles.Contains("Owner") ? "Owner" : roles.Contains("Staff") ? "Staff" : "Tenant"; result.Add((reader.GetGuid(0), role)); }
        return result;
    }
    private async Task<Guid[]> Staff(Guid location, CancellationToken t) => await db.StaffLocationAssignments.AsNoTracking()
        .Where(a => a.LocationId == location && a.StartDate <= Today && a.EndDate >= Today && db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive &&
            db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == "Staff"))))
        .Select(a => a.StaffUserId).Distinct().ToArrayAsync(t);
    private async Task<Guid[]> Owners(CancellationToken t) => await db.Users.AsNoTracking()
        .Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == BHome.Domain.IdentityAccess.Roles.Owner))).Select(u => u.Id).ToArrayAsync(t);
    internal async Task<int> PublishAuthenticationAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        var count = await Audits(t, true) + await AccountLockouts(t);
        await tx.CommitAsync(t); return count;
    }

    private async Task<int> Audits(CancellationToken t, bool authenticationOnly = false)
    {
        var source = new List<(Guid Id, string Event, Guid Target, DateTimeOffset At)>();
        await using (var cmd = await sql.Command("""
            SELECT n.id,n.notification_type,COALESCE(n.related_entity_id,(n.event_data->'state'->>'targetId')::uuid,(n.event_data->'state'->>'targetUserId')::uuid),n.event_at
            FROM notifications n WHERE n.record_kind='AUDIT' AND COALESCE((n.event_data->'state'->>'succeeded')::boolean,(n.event_data->>'succeeded')::boolean,(n.event_data->>'Succeeded')::boolean,true)
            AND n.notification_type IN ('PasswordChange','PasswordReset','AccountActivated','AccountDeactivated','AccountInvitationAccepted','RoleChanged','StaffCreated','InvoiceDraftGenerated',
              'ContractSigningInitiated','ContractSigningPrepared','ContractSigningRequested','InternalSigningInvitationApproved','ContractActivated','ContractRenewalPrepared','OperatingPolicyAmendmentCancelled','OperatingPolicyAmendmentApplied')
            AND (NOT @authenticationOnly OR n.notification_type IN ('PasswordChange','PasswordReset','AccountActivated','AccountDeactivated','AccountInvitationAccepted','RoleChanged','StaffCreated'))
            AND NOT EXISTS(SELECT 1 FROM notifications p WHERE p.record_kind='OUTBOX' AND p.event_data->>'recordType'='NotificationPublication'
              AND p.event_data->'state'->>'eventKey'='extended-audit:'||n.id::text) ORDER BY n.event_at,n.id LIMIT 50
            """, t, ("authenticationOnly", authenticationOnly)))
        { await using var reader = await cmd.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) if (!reader.IsDBNull(2)) source.Add((reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2), reader.GetFieldValue<DateTimeOffset>(3))); }
        var count = 0;
        foreach (var e in source)
        {
            var key = "extended-audit:" + e.Id;
            if (e.Event.StartsWith("Password") || e.Event is "AccountActivated" or "AccountDeactivated" or "AccountInvitationAccepted" or "RoleChanged" or "StaffCreated")
            {
                var (eventType, title) = e.Event switch
                {
                    "PasswordChange" => ("PASSWORD_CHANGED", "Mật khẩu của bạn đã được thay đổi"),
                    "PasswordReset" => ("PASSWORD_RESET_COMPLETED", "Mật khẩu của bạn đã được đặt lại"),
                    "AccountActivated" => ("ACCOUNT_ACTIVATED", "Tài khoản BHOME đã được kích hoạt"),
                    "AccountDeactivated" => ("ACCOUNT_DEACTIVATED", "Tài khoản BHOME đã bị vô hiệu hóa"),
                    "AccountInvitationAccepted" => ("ACCOUNT_SETUP_COMPLETED", "Đã hoàn tất thiết lập tài khoản BHOME"),
                    "StaffCreated" => ("STAFF_ACCOUNT_CREATED", "Tài khoản Staff đã được tạo"),
                    _ => ("ACCOUNT_ACCESS_CHANGED", "Quyền truy cập tài khoản có cập nhật")
                };
                var at = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(e.At, "Asia/Ho_Chi_Minh");
                foreach (var r in await Roles([e.Target], t)) count += await sql.Emit(r.Id, r.Role, null, key,
                    eventType, "Account", title, $"{title}.\nThời điểm: {at:HH:mm dd/MM/yyyy} (giờ Việt Nam).\nNếu không phải bạn hoặc không được thông báo về thay đổi này, hãy liên hệ Owner ngay để kiểm tra tài khoản.",
                    "Account", r.Id, t, channels: e.Event == "StaffCreated" ? ["IN_APP"] : ["IN_APP", "EMAIL"]);
            }
            else if (e.Event == "ContractSigningRequested")
            {
                var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == e.Target && c.Status == ContractStatus.PendingSigning, t);
                if (contract is not null)
                    foreach (var signature in await db.Set<ContractSignature>().AsNoTracking().Where(s => s.ContractId == contract.Id && s.Status == SignatureStatus.Pending && s.ProviderReference != null).ToArrayAsync(t))
                        foreach (var r in await Roles([signature.SignerUserId], t))
                            count += await sql.Emit(r.Id, r.Role, contract.Room.LocationId, $"signing-request:{signature.Id}", "CONTRACT_SIGNING_INVITATION", "Contract",
                                "Có lời mời ký hợp đồng", "Kiểm tra lời mời qua email hoặc ứng dụng BHOME.", "Contract", contract.Id, t);
            }
            else if (e.Event == "InternalSigningInvitationApproved")
            {
                var invitations = await db.Set<ContractSigningInvitation>().AsNoTracking().Where(i => i.ContractId == e.Target && i.RevokedAt == null && i.ExpiresAt > sql.Now).ToArrayAsync(t);
                var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == e.Target && c.Status == ContractStatus.PendingSigning, t);
                if (contract is not null)
                    foreach (var invitation in invitations)
                    {
                        var signer = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.IsActive && u.EmailConfirmed && u.Email == invitation.RecipientEmail, t);
                        if (signer is not null && (await Roles([signer.Id], t)).Any(r => r.Role == "Tenant"))
                            count += await sql.Emit(signer.Id, "Tenant", contract.Room.LocationId, $"signing-invitation:{invitation.Id}", "CONTRACT_SIGNING_INVITATION", "Contract",
                                "Có lời mời ký hợp đồng", "Kiểm tra lời mời qua email hoặc ứng dụng BHOME.", "Contract", contract.Id, t);
                    }
            }
            else if (e.Event == "InvoiceDraftGenerated")
            {
                var invoice = await db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == e.Target, t);
                if (invoice is not null) foreach (var user in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).ToArrayAsync(t))
                        count += await sql.Emit(user, "Tenant", invoice.LocationId, key, "INVOICE_DRAFT_CREATED", "Invoice", "Có hóa đơn nháp để kiểm tra",
                            $"Phòng {invoice.RoomNumber} có hóa đơn nháp kỳ {invoice.BillingPeriod:MM/yyyy}. Mở hóa đơn để xem trạng thái mới nhất.", "Invoice", invoice.Id, t, channels: ["IN_APP", "PUSH", "EMAIL"]);
            }
            else
            {
                var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == e.Target, t);
                if (contract is not null)
                {
                    var eventType = e.Event.StartsWith("OperatingPolicyAmendment", StringComparison.Ordinal) ? e.Event == "OperatingPolicyAmendmentApplied" ? "OPERATING_POLICY_AMENDMENT_APPLIED" : "OPERATING_POLICY_AMENDMENT_CANCELLED" :
                        e.Event == "ContractActivated" ? "CONTRACT_ACTIVATED" : e.Event == "ContractRenewalPrepared" ? "CONTRACT_RENEWAL_ACTION_REQUIRED" : "CONTRACT_SIGNING_REQUIRED";
                    foreach (var r in await Roles(new[] { contract.OwnerSignerId, contract.TenantUserId ?? Guid.Empty }, t))
                        count += await sql.Emit(r.Id, r.Role, contract.Room.LocationId, "contract-state:" + contract.Id + ":" + eventType, eventType, "Contract",
                            eventType == "CONTRACT_ACTIVATED" ? "Hợp đồng đã được kích hoạt" : "Hợp đồng có bước cần thực hiện",
                            "Mở hợp đồng của bạn để xem trạng thái và hành động được phép.", "Contract", contract.Id, t, channels: ["IN_APP", "PUSH", "EMAIL"]);
                }
            }
            await Mark(key, t);
        }
        return count;
    }

    private async Task<int> AccountLockouts(CancellationToken t)
    {
        var rows = new List<(Guid User, DateTimeOffset Until, string Key)>();
        await using (var cmd = await sql.Command("""
            SELECT u.id,u.lockout_end,'account-lockout:'||u.id::text||':'||floor(extract(epoch FROM u.lockout_end)*1000)::bigint::text AS key
            FROM users u WHERE u.is_active AND u.lockout_end>@now AND NOT EXISTS(
              SELECT 1 FROM notifications n WHERE n.record_kind='INBOX' AND n.recipient_user_id=u.id AND
              n.event_key='account-lockout:'||u.id::text||':'||floor(extract(epoch FROM u.lockout_end)*1000)::bigint::text)
            ORDER BY u.lockout_end,u.id LIMIT 25
            """, t, ("now", sql.Now)))
        { await using var r = await cmd.ExecuteReaderAsync(t); while (await r.ReadAsync(t)) rows.Add((r.GetGuid(0), r.GetFieldValue<DateTimeOffset>(1), r.GetString(2))); }
        var count = 0;
        foreach (var row in rows)
        {
            var until = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(row.Until, "Asia/Ho_Chi_Minh");
            foreach (var r in await Roles([row.User], t)) count += await sql.Emit(r.Id, r.Role, null, row.Key, "ACCOUNT_LOCKED", "Account", "Tài khoản tạm khóa đăng nhập",
                $"Tài khoản tạm khóa theo cơ chế bảo mật đăng nhập hiện có đến {until:HH:mm dd/MM/yyyy} (giờ Việt Nam). Nếu không phải bạn, hãy liên hệ Owner.", "Account", r.Id, t, channels: ["IN_APP", "EMAIL"]);
        }
        return count;
    }
    private async Task<int> Incidents(CancellationToken t)
    {
        var rows = await db.Set<IncidentNotification>().AsNoTracking().Where(n => !db.Set<NotificationPublication>().Any(p => p.EventKey == "incident:" + n.Id.ToString()))
            .OrderBy(n => n.CreatedAt).Take(50).ToArrayAsync(t); var count = 0;
        foreach (var n in rows)
        {
            var report = await db.Set<IncidentReport>().AsNoTracking().SingleAsync(r => r.Id == n.IncidentId, t);
            foreach (var r in await Roles([n.RecipientId], t))
            {
                if (r.Role == "Staff" && !(await Staff(report.LocationId, t)).Contains(r.Id))
                { db.Attach(n); n.DeliveryState = "Suppressed"; continue; }
                var eventType = n.Event switch
                {
                    "submitted" => n.HighPriority ? "INCIDENT_EMERGENCY_SUBMITTED" : "INCIDENT_NORMAL_SUBMITTED",
                    "acknowledged" => "EMERGENCY_ACKNOWLEDGED",
                    "assigned" or "reassigned" => "WORK_ORDER_ASSIGNED",
                    "proposal_submitted" => "REPAIR_PROPOSAL_REQUIRES_APPROVAL",
                    "submit" => "WORK_ORDER_VERIFICATION_REQUIRED",
                    "rework" => "WORK_ORDER_REWORK_REQUESTED",
                    "resolved" or "rejected" or "duplicate" => "INCIDENT_CLOSED",
                    _ => "INCIDENT_UPDATED"
                };
                count += await sql.Emit(r.Id, r.Role, report.LocationId, "incident:" + n.Id, eventType, "Incident",
                    n.HighPriority && n.Event == "submitted" ? "Có sự cố khẩn cấp tại cơ sở" : "Sự cố có cập nhật",
                    "Mở sự cố để xem thông tin và hành động trong phạm vi được phân công. Trường hợp đe dọa tính mạng, gọi cơ quan khẩn cấp phù hợp.",
                    "Incident", report.Id, t, n.HighPriority && n.Event == "submitted" ? "P0" : "P1", channels: n.DeliveryState == "Delivered" ? ["IN_APP"] : ["IN_APP", "PUSH"], taskSource: n.Id);
            }
            await Mark("incident:" + n.Id, t);
        }
        return count;
    }
    private async Task<int> MeterReadings(CancellationToken t)
    {
        var rows = await db.Set<MeterReading>().AsNoTracking().Where(r => r.ConfirmedAt != default &&
            (r.Status == MeterReadingStatus.Confirmed || r.Status == MeterReadingStatus.Corrected) &&
            db.Set<OperationalTask>().Any(x => x.Id == r.TaskId && x.MeterId == r.MeterId && x.Status == MeterTaskStatus.Completed) &&
            db.Set<MeterEvidence>().Any(e => e.Id == r.EvidenceId && e.TaskId == r.TaskId && e.IsUploaded && e.IsLinked) &&
            !db.Set<NotificationPublication>().Any(p => p.EventKey == "meter-confirmed:" + r.Id.ToString()))
            .OrderBy(r => r.ConfirmedAt).Take(25).ToArrayAsync(t); var count = 0;
        foreach (var reading in rows)
        {
            var meter = await db.Set<BHome.Domain.Billing.Meter>().AsNoTracking().SingleAsync(m => m.Id == reading.MeterId, t);
            var task = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(x => x.Id == reading.TaskId, t);
            var from = task.BillingPeriod ?? task.ReadingDate; var to = task.BillingPeriod.HasValue ? from.AddMonths(1).AddDays(-1) : from;
            var users = await Occupants(meter.RoomId, from, to, t);
            var location = await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.Id == meter.RoomId).Select(r => r.LocationId).SingleAsync(t);
            foreach (var user in users) count += await sql.Emit(user, "Tenant", location, "meter-confirmed:" + reading.Id, "METER_READING_CONFIRMED", "Invoice",
                "Chỉ số điện/nước đã được xác nhận", "Staff đã xác nhận chỉ số cho kỳ đo liên quan. Mở chỉ số điện nước để kiểm tra trước khi lập hóa đơn.", "MeterReading", reading.Id, t, "P2", ["IN_APP", "EMAIL"]);
            await Mark("meter-confirmed:" + reading.Id, t);
        }
        return count;
    }
    private async Task<Guid[]> Occupants(Guid room, DateOnly periodStart, DateOnly periodEnd, CancellationToken t)
    {
        return await (from cr in db.Set<ContractResident>().AsNoTracking()
                      join c in db.Set<Contract>() on cr.ContractId equals c.Id
                      join r in db.Set<Resident>() on cr.ResidentId equals r.Id
                      where c.RoomId == room && c.ActivatedAt != null && c.Kind != ContractKind.Holding &&
                        (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                        c.StartDate <= periodEnd && (c.ActualEndDate ?? c.EndDate) >= periodStart &&
                        cr.ResidenceFrom <= periodEnd && (cr.ResidenceTo == null || cr.ResidenceTo >= periodStart) && r.TenantUserId != null
                      select r.TenantUserId!.Value).Distinct().ToArrayAsync(t);
    }
    private async Task<int> Unmatched(CancellationToken t)
    {
        var rows = await db.Set<BHome.Domain.PaymentsDebt.PaymentTransfer>().AsNoTracking()
            .Where(x => !db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TransferId == x.Id) && !db.Set<NotificationPublication>().Any(p => p.EventKey == "unmatched:" + x.Id.ToString()))
            .OrderBy(x => x.Id).Take(25).ToArrayAsync(t); var count = 0;
        foreach (var transfer in rows)
        {
            foreach (var owner in await Owners(t)) count += await sql.Emit(owner, "Owner", null, "unmatched:" + transfer.Id, "BANK_TRANSACTION_UNMATCHED", "Payment",
                "Có giao dịch cần đối soát", "Giao dịch ngân hàng chưa được phân bổ. Không xác nhận Tenant đã thanh toán trước khi đối soát hợp lệ.", "BankTransfer", transfer.Id, t);
            await Mark("unmatched:" + transfer.Id, t);
        }
        return count;
    }
    private async Task<int> OperationalAlerts(CancellationToken t)
    {
        var count = 0;
        var tasks = await db.Set<OperationalTask>().AsNoTracking().Where(x => x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled &&
            (x.AssignedStaffUserId == null || !db.StaffLocationAssignments.Any(a => a.LocationId == x.LocationId && a.StaffUserId == x.AssignedStaffUserId && a.StartDate <= Today && a.EndDate >= Today)) &&
            !db.Set<NotificationPublication>().Any(p => p.EventKey == "task-unassigned:" + x.Id.ToString() + ":" + x.Version.ToString())).OrderBy(x => x.Id).Take(25).ToArrayAsync(t);
        foreach (var task in tasks)
        {
            var key = $"task-unassigned:{task.Id}:{task.Version}";
            foreach (var owner in await Owners(t)) count += await sql.Emit(owner, "Owner", task.LocationId, key, "TASK_UNASSIGNED", "Task",
                "Công việc chưa có Staff hợp lệ", "Owner cần kiểm tra phân công tại cơ sở. Công việc được giữ lại để xử lý.", task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, t);
            await Mark(key, t);
        }
        var until = Today.AddDays(30);
        var contracts = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).Where(c => c.Status == ContractStatus.Active && c.Kind != ContractKind.Holding && c.EndDate <= until).ToArrayAsync(t);
        foreach (var contract in contracts)
        {
            var key = $"contract-expiry-v2:{contract.Id}:{contract.EndDate:yyyyMMdd}:{(contract.EndDate < Today ? "expired" : "upcoming")}";
            if (await Done(key, t)) continue;
            foreach (var r in await Roles(new[] { contract.OwnerSignerId, contract.TenantUserId ?? Guid.Empty }, t))
                count += await sql.Emit(r.Id, r.Role, contract.Room.LocationId, key, "CONTRACT_EXPIRY_REMINDER", "Contract", "Hợp đồng đến kỳ xử lý",
                    "Mở hợp đồng của bạn để xem thời hạn và thực hiện gia hạn hoặc trả phòng.", "Contract", contract.Id, t);
            foreach (var staff in await Staff(contract.Room.LocationId, t)) count += await sql.Emit(staff, "Staff", contract.Room.LocationId, key, "CONTRACT_EXPIRY_REMINDER", "Contract",
                "Có hợp đồng đến kỳ xử lý tại cơ sở", "Vui lòng phối hợp Owner xử lý gia hạn hoặc trả phòng trong phạm vi cơ sở được phân công.", "Location", contract.Room.LocationId, t);
            await Mark(key, t);
        }
        return count;
    }
}
