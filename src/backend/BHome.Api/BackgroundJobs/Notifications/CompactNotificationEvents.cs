using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

// Consumes durable audit/domain intents already committed with their business transaction.
internal sealed partial class CompactNotificationEvents(Compact24DbContext db, CompactNotificationWriter sql)
{
    private DateOnly Today => BillingAutomationDates.BusinessDate(sql.Now);
    private Task<bool> Done(string key, CancellationToken t) => NotificationPublications.Keys(db).ContainsAsync(key, t);
    private Task Mark(string key, CancellationToken t) => NotificationPublications.SaveAsync(db, key, sql.Now, 0, t);
    internal async Task<int> PublishAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        var count = await Audits(t) + await QueueHoldingConfirmationsAsync(t) + await AccountLockouts(t) + await Incidents(t) + await MeterReadings(t) + await Reminders(t) + await Unmatched(t) + await OperationalAlerts(t);
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
    private IQueryable<NativeOperationalTaskPersistence.AssignmentRow> CurrentAssignments() =>
        db.Database.SqlQuery<NativeOperationalTaskPersistence.AssignmentRow>($"""
            SELECT l.id AS "LocationId",(a->>'id')::uuid AS "AssignmentId",
                (a->>'staffUserId')::uuid AS "StaffUserId",l.is_active AS "IsActive"
            FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            WHERE (a->>'startDate')::date<={Today} AND (a->>'endDate')::date>={Today}
            """);
    private async Task<Guid[]> Staff(Guid location, CancellationToken t) => await CurrentAssignments()
        .Where(a => a.LocationId == location && db.Users.Any(u => u.Id == a.StaffUserId && u.IsActive &&
            EF.Property<string[]>(u, "roles").Contains("Staff")))
        .Select(a => a.StaffUserId).Distinct().ToArrayAsync(t);
    private async Task<Guid[]> Owners(CancellationToken t) => await db.Users.AsNoTracking()
        .Where(u => u.IsActive && EF.Property<string[]>(u, "roles").Contains(BHome.Domain.IdentityAccess.Roles.Owner)).Select(u => u.Id).ToArrayAsync(t);
    internal async Task<int> PublishAuthenticationAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        var count = await Audits(t, true) + await AccountLockouts(t);
        await tx.CommitAsync(t); return count;
    }

    internal async Task<int> PublishBillingAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        var count = await Audits(t, billingOnly: true) + await MeterReadings(t) + await Reminders(t, billingOnly: true);
        await tx.CommitAsync(t); return count;
    }

    internal Task<int> QueueHoldingConfirmationsAsync(CancellationToken t) => sql.Execute("""
        INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
        SELECT gen_random_uuid(),'OUTBOX','holding-confirmed:'||replace(c.id::text,'-',''),'CHANNEL_DELIVERY',
          jsonb_build_object('schemaVersion',1,'recordType','ChannelDelivery','notificationId',@empty,'recipient',c.owner_signer_id,
            'role','Owner','channel','EMAIL','eventType','HOLDING_CONFIRMED','holdingContractId',c.id),@now,'Pending',@now
        FROM contracts c
        WHERE c.contract_type='HOLDING' AND c.activated_at IS NOT NULL AND c.status IN (@active,@converted)
          AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.record_kind='OUTBOX' AND n.event_key='holding-confirmed:'||replace(c.id::text,'-',''))
          AND NOT COALESCE((SELECT (h->'state'->>'isDevelopmentDemo')::boolean FROM jsonb_array_elements(c.history) WITH ORDINALITY j(h,position)
              WHERE h->>'recordType'='Contract' ORDER BY position DESC LIMIT 1),false)
        ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
        """, t, ("empty", Guid.Empty), ("now", sql.Now), ("active", (int)ContractStatus.Active), ("converted", (int)ContractStatus.Converted));

    internal async Task PublishMainActivationsAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        await Audits(t, mainActivationOnly: true);
        await tx.CommitAsync(t);
    }

    internal async Task PublishOwnerSigningRequestsAsync(CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-notification-publication-v2',0))", t);
        await Audits(t, ownerSigningOnly: true);
        await tx.CommitAsync(t);
    }

    private async Task<int> Audits(CancellationToken t, bool authenticationOnly = false, bool mainActivationOnly = false, bool ownerSigningOnly = false, bool billingOnly = false)
    {
        var source = new List<(Guid Id, string Event, Guid Target, DateTimeOffset At)>();
        await using (var cmd = await sql.Command("""
            SELECT n.id,n.notification_type,COALESCE(n.related_entity_id,(n.event_data->'state'->>'targetId')::uuid,(n.event_data->'state'->>'targetUserId')::uuid),n.event_at
            FROM notifications n WHERE n.record_kind='AUDIT' AND COALESCE((n.event_data->'state'->>'succeeded')::boolean,(n.event_data->>'succeeded')::boolean,(n.event_data->>'Succeeded')::boolean,true)
            AND n.notification_type IN ('PasswordChange','PasswordReset','AccountActivated','AccountDeactivated','AccountInvitationAccepted','RoleChanged','StaffCreated','InvoiceDraftGenerated',
              'ContractMoveOutRequested','ContractSigningInitiated','ContractSigningPrepared','ContractSigningRequested','InternalSigningInvitationApproved','ContractActivated','ContractRenewalPrepared','OperatingPolicyAmendmentCancelled','OperatingPolicyAmendmentApplied',
              'HoldingDraftCreated','HoldingSigningSubmitted','MainSigningSubmitted','HoldingActivated','Automatic:HoldingActivated','Automatic:ContractActivated')
            AND (NOT @authenticationOnly OR n.notification_type IN ('PasswordChange','PasswordReset','AccountActivated','AccountDeactivated','AccountInvitationAccepted','RoleChanged','StaffCreated'))
            AND (NOT @billingOnly OR n.notification_type='InvoiceDraftGenerated')
            AND (NOT @mainActivationOnly OR n.notification_type IN ('ContractActivated','Automatic:ContractActivated'))
            AND (NOT @ownerSigningOnly OR n.notification_type IN ('HoldingSigningSubmitted','MainSigningSubmitted'))
            AND NOT EXISTS(SELECT 1 FROM notifications p WHERE p.record_kind='OUTBOX' AND p.event_data->>'recordType'='NotificationPublication'
              AND p.event_data->'state'->>'eventKey'='extended-audit:'||n.id::text) ORDER BY n.event_at,n.id LIMIT 50
            """, t, ("authenticationOnly", authenticationOnly), ("mainActivationOnly", mainActivationOnly), ("ownerSigningOnly", ownerSigningOnly), ("billingOnly", billingOnly)))
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
            else if (e.Event == "ContractMoveOutRequested")
            {
                var move = await NativeContractMoveOutPersistence.MoveAsync(db, e.Target, t);
                var contract = move is { IsExpiry: false, Status: MoveOutStatus.Requested }
                    ? await NativeContractSnapshot.LoadAsync(db, e.Target, t) : null;
                var location = contract?.Room.LocationId;
                if (location is { } locationId)
                {
                    var eligible = StaffEmploymentEligibility.EligibleIds(db, Today);
                    var staff = await CurrentAssignments()
                        .Where(a => a.LocationId == locationId &&
                            eligible.Contains(a.StaffUserId))
                        .Select(a => a.StaffUserId).Distinct().ToArrayAsync(t);
                    foreach (var owner in await Owners(t))
                        count += await sql.Emit(owner, "Owner", locationId, $"contract-move-out-requested:{e.Target:N}:{e.Id:N}",
                            "CONTRACT_MOVE_OUT_REQUESTED", "Contract", "Có yêu cầu kết thúc hợp đồng",
                            "Mở hợp đồng để xem xét yêu cầu kết thúc do khách thuê gửi.", "Contract", e.Target, t);
                    foreach (var assignee in staff)
                        count += await sql.Emit(assignee, "Staff", locationId, $"contract-move-out-requested:{e.Target:N}:{e.Id:N}",
                            "CONTRACT_MOVE_OUT_REQUESTED", "Contract", "Có yêu cầu kết thúc hợp đồng",
                            "Khách thuê đã gửi yêu cầu kết thúc hợp đồng. Mở hợp đồng để theo dõi trạng thái.", "Contract", e.Target, t);
                }
            }
            else if (e.Event == "HoldingDraftCreated")
            {
                var draft = await NativeContractSnapshot.LoadAsync(db, e.Target, t);
                if (draft is { Kind: ContractKind.Holding, Status: ContractStatus.Draft })
                    count += await sql.Emit(draft.OwnerSignerId, "Owner", draft.Room.LocationId, $"holding-draft:{draft.Id:N}",
                        "HOLDING_DRAFT_CREATED", "Contract", "Có bản nháp hợp đồng giữ chỗ",
                        $"Phòng {draft.Room.RoomNumber} tại {draft.Room.Location.Name} có bản nháp giữ chỗ để xem xét.",
                        "Contract", draft.Id, t, channels: ["IN_APP"]);
            }
            else if (e.Event is "HoldingSigningSubmitted" or "MainSigningSubmitted" or "HoldingActivated" or "Automatic:HoldingActivated")
            {
                var holding = await NativeContractSnapshot.LoadAsync(db, e.Target, t);
                if (holding is not null && holding.Kind is not (ContractKind.Holding or ContractKind.Main)) holding = null;
                if (holding is not null && e.Event is "HoldingSigningSubmitted" or "MainSigningSubmitted")
                    count += await sql.Emit(holding.OwnerSignerId, "Owner", holding.Room.LocationId,
                        $"{(holding.Kind == ContractKind.Holding ? "holding" : "main")}-owner-signing:{holding.Id}:{holding.SnapshotHashOrEmpty}",
                        holding.Kind == ContractKind.Holding ? "HOLDING_OWNER_SIGNING_REQUIRED" : "MAIN_OWNER_SIGNING_REQUIRED", "Contract",
                        holding.Kind == ContractKind.Holding ? "Hợp đồng giữ chỗ cần ký" : "Hợp đồng thuê cần ký",
                        $"Bạn có hợp đồng {(holding.Kind == ContractKind.Holding ? "giữ chỗ" : "thuê")} phòng {holding.Room.RoomNumber} tại {holding.Room.Location.Name} đang chờ ký.",
                        "Contract", holding.Id, t, channels: holding.Kind == ContractKind.Holding ? ["IN_APP", "EMAIL"] : ["IN_APP"]);
                else if (holding is not null && !holding.IsDevelopmentDemo && holding.Status == ContractStatus.Active && holding.Room.Status == BHome.Domain.PropertyManagement.RoomStatus.OnHold)
                {
                    count += await sql.Emit(holding.OwnerSignerId, "Owner", holding.Room.LocationId,
                        $"holding-activated:{holding.Id:N}", "HOLDING_ACTIVATED", "Contract",
                        "Giữ chỗ đã được kích hoạt",
                        $"Phòng {holding.Room.RoomNumber} tại {holding.Room.Location.Name} đã giữ chỗ thành công. Tiền giữ chỗ đã được xác minh.",
                        "Contract", holding.Id, t, channels: ["IN_APP"]);
                }
            }
            else if (e.Event == "ContractSigningRequested")
            {
                var contract = await NativeContractSnapshot.LoadAsync(db, e.Target, t);
                if (contract is { Status: ContractStatus.PendingSigning })
                    foreach (var signature in contract.Signatures.Where(s => s.Status == SignatureStatus.Pending && s.ProviderReference != null))
                        foreach (var r in await Roles([signature.SignerUserId], t))
                            count += await sql.Emit(r.Id, r.Role, contract.Room.LocationId, $"signing-request:{signature.Id}", "CONTRACT_SIGNING_INVITATION", "Contract",
                                "Có lời mời ký hợp đồng", "Kiểm tra lời mời qua email hoặc ứng dụng BHOME.", "Contract", contract.Id, t);
            }
            else if (e.Event == "InternalSigningInvitationApproved")
            {
                var invitations = (await NativeInvitationPersistence.ForContractAsync(db, e.Target, t)).Where(i => i.RevokedAt == null && i.ExpiresAt > sql.Now).ToArray();
                var contract = await NativeContractSnapshot.LoadAsync(db, e.Target, t);
                if (contract is { Status: ContractStatus.PendingSigning })
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
                var invoice = (await NativeInvoicePersistence.ReadAsync(db, db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking()
                    .Where(i => i.Id == e.Target), t, false)).SingleOrDefault();
                if (invoice is not null) foreach (var user in invoice.Recipients.Select(r => r.TenantUserId))
                        count += await sql.Emit(user, "Tenant", invoice.LocationId, key, "INVOICE_DRAFT_CREATED", "Invoice", "Có hóa đơn nháp để kiểm tra",
                            $"Phòng {invoice.RoomNumber} có hóa đơn nháp kỳ {invoice.BillingPeriod:MM/yyyy}. Mở hóa đơn để xem trạng thái mới nhất.", "Invoice", invoice.Id, t, channels: ["IN_APP", "PUSH", "EMAIL"]);
            }
            else
            {
                var contract = await NativeContractSnapshot.LoadAsync(db, e.Target, t);
                if (contract is not null)
                {
                    var eventType = e.Event.StartsWith("OperatingPolicyAmendment", StringComparison.Ordinal) ? e.Event == "OperatingPolicyAmendmentApplied" ? "OPERATING_POLICY_AMENDMENT_APPLIED" : "OPERATING_POLICY_AMENDMENT_CANCELLED" :
                        e.Event is "ContractActivated" or "Automatic:ContractActivated" ? "CONTRACT_ACTIVATED" : e.Event == "ContractRenewalPrepared" ? "CONTRACT_RENEWAL_ACTION_REQUIRED" : "CONTRACT_SIGNING_REQUIRED";
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
        var publicationKeys = NotificationPublications.Keys(db);
        var ids = await db.Set<Native.Notification>().FromSqlRaw("SELECT * FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='IncidentNotification'").AsNoTracking()
            .Where(n => !publicationKeys.Contains("incident:" + n.Id.ToString()))
            .OrderBy(n => n.EventAt).Take(50).Select(n => n.Id).ToArrayAsync(t);
        var count = 0;
        foreach (var id in ids)
        {
            var n = await NativeIncidentSession.ReadNotificationAsync(db, id, t);
            if (n is null) continue;
            var report = await db.Set<IncidentReport>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == n.IncidentId, t);
            var work = n.WorkOrderId is { } workId ? await db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().SingleOrDefaultAsync(w => w.Id == workId && w.TaskType == "WORK_ORDER", t) : null;
            var location = report?.LocationId ?? work?.LocationId ?? throw new InvalidOperationException("missing_maintenance_notification_scope");
            foreach (var r in await Roles([n.RecipientId], t))
            {
                if (r.Role == "Staff" && !(await Staff(location, t)).Contains(r.Id))
                { n.DeliveryState = "Suppressed"; await NativeIncidentWrites.WriteAsync(db, n, false, null, t); continue; }
                var eventType = n.EventType;
                count += await sql.Emit(r.Id, r.Role, location, "incident:" + n.Id, eventType, "Incident",
                    n.HighPriority && n.Event == "submitted" ? "Có sự cố khẩn cấp tại cơ sở" : "Sự cố có cập nhật",
                    "Mở sự cố để xem thông tin và hành động trong phạm vi được phân công. Trường hợp đe dọa tính mạng, gọi cơ quan khẩn cấp phù hợp.",
                    report is null ? "WorkOrder" : "Incident", report?.Id ?? work!.Id, t, n.HighPriority && n.Event == "submitted" ? "P0" : "P1", channels: n.DeliveryState == "Delivered" ? ["IN_APP"] : ["IN_APP", "PUSH"], taskSource: n.Id);
            }
            await Mark("incident:" + n.Id, t);
        }
        return count;
    }
    private async Task<int> MeterReadings(CancellationToken t)
    {
        var publicationKeys = NotificationPublications.Keys(db);
        var rows = await db.Set<BHome.Domain.Billing.MeterReading>().FromSqlRaw("""
            SELECT r.* FROM meter_readings r JOIN operational_tasks t ON t.id=r.operational_task_id
            WHERE t.task_type='METER_READ' AND t.status='2' AND t.meter_id=r.meter_id
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.evidence) e
                WHERE e->>'recordType'='MeterEvidence' AND e->>'taskId'=t.id::text
                  AND e->>'id'=(SELECT h->'state'->>'evidenceId' FROM jsonb_array_elements(r.history)
                    WITH ORDINALITY a(h,n) WHERE h->>'recordType'='MeterReading' ORDER BY n DESC LIMIT 1)
                  AND e->>'isLinked'='true' AND e->>'isUploaded'='true')
            """).AsNoTracking().Where(r => r.ConfirmedAt != default &&
            (r.Status == MeterReadingStatus.Confirmed || r.Status == MeterReadingStatus.Corrected) &&
            !publicationKeys.Contains("meter-confirmed:" + r.Id.ToString()))
            .OrderBy(r => r.ConfirmedAt).Take(25).ToArrayAsync(t); var count = 0;
        foreach (var reading in rows)
        {
            var meter = await db.Set<BHome.Domain.Billing.Meter>().AsNoTracking().SingleAsync(m => m.Id == reading.MeterId, t);
            var task = NativeCaptureReads.Task(await db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().SingleAsync(x => x.Id == reading.TaskId, t));
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
        return await (from cr in db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking()
                      join c in db.Set<BHome.Domain.TenantContracts.Contract>() on cr.ContractId equals c.Id
                      join r in db.Set<BHome.Domain.TenantContracts.Resident>() on cr.ResidentId equals r.Id
                      where c.RoomId == room && c.ActivatedAt != null && c.Kind != BHome.Domain.TenantContracts.ContractKind.Holding &&
                        (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                        c.StartDate <= periodEnd && (c.ActualEndDate ?? c.EndDate) >= periodStart &&
                        cr.ResidenceFrom <= periodEnd && (cr.ResidenceTo == null || cr.ResidenceTo >= periodStart) && r.TenantUserId != null
                      select r.TenantUserId!.Value).Distinct().ToArrayAsync(t);
    }
    private async Task<int> Unmatched(CancellationToken t)
    {
        var publicationKeys = NotificationPublications.Keys(db);
        var rows = await BHome.Infrastructure.PaymentsDebt.PaymentLedgerQueries.ReceiptEntities(db)
            .Where(x => !db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.SourcePaymentId == x.Id &&
                (a.TargetInvoiceId != null || a.TargetDepositContractId != null || a.TargetSettlementContractId != null || a.TargetInitialContractId != null)) &&
                !publicationKeys.Contains("unmatched:" + x.Id.ToString()))
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
        var publicationKeys = NotificationPublications.Keys(db);
        var assignments = CurrentAssignments();
        var eligible = StaffEmploymentEligibility.EligibleIds(db, Today);
        var periodic = db.Set<BHome.Domain.Billing.OperationalTask>().FromSqlRaw("SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND task_data->'state'->>'purpose'='1'").Select(x => x.Id);
        var tasks = await NativeOperationalTaskPersistence.Roots(db).Where(x => x.Status != "2" && x.Status != "3" &&
            (periodic.Contains(x.Id)
                ? !assignments.Any(a => a.LocationId == x.LocationId && eligible.Contains(a.StaffUserId))
                : x.AssignedUserId == null || !assignments.Any(a => a.LocationId == x.LocationId && a.StaffUserId == x.AssignedUserId)) &&
            !publicationKeys.Contains("task-unassigned:" + x.Id.ToString() + ":" + x.Version.ToString())).OrderBy(x => x.Id).Take(25).ToArrayAsync(t);
        foreach (var row in tasks)
        {
            var task = NativeCaptureReads.Task(row);
            var key = $"task-unassigned:{task.Id}:{task.Version}";
            foreach (var owner in await Owners(t)) count += await sql.Emit(owner, "Owner", task.RequiredLocationId, key, "TASK_UNASSIGNED", "Task",
                "Công việc chưa có Staff hợp lệ", "Owner cần kiểm tra phân công tại cơ sở. Công việc được giữ lại để xử lý.", task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, t);
            await Mark(key, t);
        }
        var until = Today.AddDays(30);
        var contracts = await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.Status == ContractStatus.Active && c.Kind != BHome.Domain.TenantContracts.ContractKind.Holding && c.EndDate <= until).Select(c => c.Id).ToArrayAsync(t);
        foreach (var id in contracts)
        {
            var contract = await NativeContractSnapshot.LoadAsync(db, id, t);
            if (contract is null) continue;
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
