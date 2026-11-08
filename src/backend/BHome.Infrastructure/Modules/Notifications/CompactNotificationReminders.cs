using System.Globalization;
using System.Text.Json;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class CompactNotificationEvents
{
    private async Task<int> Reminders(CancellationToken t)
    {
        var policies = new List<(Guid Id, NotificationReminderPolicy Policy)>();
        await using (var cmd = await sql.Command("SELECT id,operating_settings->'notificationPolicy' FROM locations WHERE is_active AND operating_settings ? 'notificationPolicy'", t))
        { await using var reader = await cmd.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) policies.Add((reader.GetGuid(0), JsonSerializer.Deserialize<NotificationReminderPolicy>(reader.GetString(1), CompactNotificationWriter.Json)!)); }
        var count = 0;
        foreach (var (location, policy) in policies)
        {
            if (policy.InvoiceDueSoonDays is >= 1 and <= 30)
            {
                var until = Today.AddDays(policy.InvoiceDueSoonDays.Value);
                var invoices = await db.Set<Invoice>().AsNoTracking().Where(i => i.LocationId == location && i.Status == InvoiceStatus.Final && i.DueDate >= Today && i.DueDate <= until).ToArrayAsync(t);
                foreach (var invoice in invoices)
                {
                    var key = $"invoice-due-soon:{invoice.Id}:{invoice.DueDate:yyyyMMdd}";
                    if (await Done(key, t) || (await db.FinancialsAsync(invoice.Id, t)).OutstandingAmount <= 0) continue;
                    foreach (var recipient in await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).ToArrayAsync(t))
                        count += await sql.Emit(recipient, "Tenant", location, key, "INVOICE_DUE_SOON", "Invoice", "Hóa đơn sắp đến hạn", "Hóa đơn còn nghĩa vụ thanh toán. Mở hóa đơn để kiểm tra số dư hiện tại.", "Invoice", invoice.Id, t);
                    await Mark(key, t);
                }
            }
            if (policy.DebtEnabled && policy.DebtWindowDays is > 0)
            {
                var invoices = await db.Set<Invoice>().AsNoTracking().Where(i => i.LocationId == location && i.Status == InvoiceStatus.Final && i.DueDate < Today).OrderBy(i => i.Id).ToArrayAsync(t);
                foreach (var invoice in invoices)
                {
                    var key = $"overdue:{invoice.Id}:{Today.DayNumber / policy.DebtWindowDays}";
                    if (await Done(key, t)) continue;
                    var balance = await db.FinancialsAsync(invoice.Id, t); if (balance.OutstandingAmount <= 0) continue;
                    var audience = (await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoice.Id).Select(r => r.TenantUserId).ToArrayAsync(t)).Concat(await Staff(location, t)).Concat(await Owners(t));
                    foreach (var r in await Roles(audience, t)) count += await sql.Emit(r.Id, r.Role, location, key, "INVOICE_OVERDUE", "Invoice", "Hóa đơn còn dư nợ quá hạn",
                        r.Role == "Staff" ? $"Phòng {invoice.RoomNumber} cần theo dõi công nợ trong phạm vi cơ sở." : $"Phòng {invoice.RoomNumber}, kỳ {invoice.BillingPeriod:MM/yyyy} còn phải trả {balance.OutstandingAmount:N0} VND.", r.Role == "Staff" ? "Debt" : "Invoice", invoice.Id, t);
                    await Mark(key, t);
                }
            }
            if (policy.TaskEnabled && policy.TaskWindowHours is > 0)
            {
                var window = sql.Now.ToUnixTimeSeconds() / (policy.TaskWindowHours.Value * 3600L);
                var tasks = await db.Set<OperationalTask>().AsNoTracking().Where(x => x.LocationId == location && x.DueAt <= sql.Now && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled).ToArrayAsync(t);
                foreach (var task in tasks)
                {
                    var key = $"task-overdue:{task.Id}:{window}"; if (await Done(key, t)) continue;
                    var audience = (await Owners(t)).Concat(task.AssignedStaffUserId is { } staff && (await Staff(location, t)).Contains(staff) ? [staff] : Array.Empty<Guid>());
                    foreach (var r in await Roles(audience, t)) count += await sql.Emit(r.Id, r.Role, location, key, "TASK_DUE_OR_OVERDUE", "Task", "Công việc đã đến hạn",
                        "Công việc chưa hoàn tất. Vui lòng mở công việc để cập nhật tiến độ trong phạm vi được phân công.", task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading ? "MeterTask" : "OperationalTask", task.Id, t);
                    await Mark(key, t);
                }
            }
            var local = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(sql.Now, "Asia/Ho_Chi_Minh");
            if (policy.ResidenceEnabled && policy.ResidenceFrequency is "WEEKLY" or "MONTHLY" && policy.LocalSendHour is >= 0 and <= 23 && local.Hour >= policy.LocalSendHour)
            {
                var window = policy.ResidenceFrequency == "MONTHLY" ? Today.ToString("yyyyMM", CultureInfo.InvariantCulture) :
                    $"{ISOWeek.GetYear(Today.ToDateTime(TimeOnly.MinValue))}W{ISOWeek.GetWeekOfYear(Today.ToDateTime(TimeOnly.MinValue))}";
                var rows = new List<(Guid Contract, Guid Resident, Guid? User, Guid Owner)>();
                await using (var cmd = await sql.Command("""
                    SELECT cr.contract_id,cr.resident_id,r.user_id,c.owner_signer_id FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id
                    JOIN rooms rm ON rm.id=c.room_id JOIN residents r ON r.id=cr.resident_id WHERE rm.location_id=@location AND c.status=3
                    AND cr.actual_residence_from<=@today AND (cr.residence_to IS NULL OR cr.residence_to>=@today)
                    AND COALESCE(cr.registration_status,'Pending') IN ('Pending','InProgress') AND cr.owner_confirmed_at IS NULL
                    """, t, ("location", location), ("today", Today)))
                { await using var reader = await cmd.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) rows.Add((reader.GetGuid(0),reader.GetGuid(1),reader.IsDBNull(2)?null:reader.GetGuid(2),reader.GetGuid(3))); }
                foreach (var r in rows)
                {
                    var key = $"residence:{r.Contract}:{r.Resident}:{window}"; if (await Done(key, t)) continue;
                    foreach (var user in await Roles(new[] { r.User ?? Guid.Empty, r.Owner }, t)) count += await sql.Emit(user.Id, user.Role, location, key, "TEMPORARY_RESIDENCE_ACTION", "Residence",
                        "Tạm trú còn bước cần thực hiện", "Tenant thực hiện đăng ký qua VNeID bên ngoài BHOME; Owner xác nhận thông tin lưu trú trong hệ thống.", "Residence", r.Resident, t);
                    await Mark(key, t);
                }
            }
            if (policy.EmergencyEnabled && policy.EmergencyFirstEscalationMinutes is > 0 && policy.EmergencyOverdueMinutes > policy.EmergencyFirstEscalationMinutes)
            {
                var incidents = await db.Set<IncidentReport>().AsNoTracking().Where(r => r.LocationId == location && r.Severity == IncidentSeverity.Emergency && r.AcknowledgedAt == null && (r.Status == IncidentStatus.Submitted || r.Status == IncidentStatus.InProgress)).ToArrayAsync(t);
                foreach (var incident in incidents)
                {
                    var age = (sql.Now - incident.CreatedAt).TotalMinutes;
                    if (age < policy.EmergencyFirstEscalationMinutes) continue;
                    var stage = age >= policy.EmergencyOverdueMinutes ? "overdue" : "escalation"; var key = $"emergency:{incident.Id}:{stage}";
                    if (await Done(key, t)) continue;
                    foreach (var r in await Roles((await Owners(t)).Concat(await Staff(location, t)), t)) count += await sql.Emit(r.Id, r.Role, location, key,
                        stage == "overdue" ? "EMERGENCY_ACK_OVERDUE" : "EMERGENCY_ACK_ESCALATION", "Incident", "Sự cố khẩn cấp chưa được tiếp nhận",
                        "Chưa có Staff acknowledge sự cố. Đọc thông báo không thay thế việc tiếp nhận; cần mở sự cố để thực hiện hành động.", "Incident", incident.Id, t, "P0");
                    await Mark(key, t);
                }
            }
        }
        return count;
    }
}
