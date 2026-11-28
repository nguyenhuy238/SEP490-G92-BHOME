using BHome.Application.Common;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Billing;

internal sealed class BillingMeterOverdueNotifier(BHomePersistenceContext db, TimeProvider clock, CompactNotificationWriter? sql = null)
{
    internal async Task NotifyAsync(CancellationToken t)
    {
        if (sql is null || db is not Compact24DbContext compact) return;
        var now = clock.BusinessUtcNow();
        var today = clock.BusinessToday();
        var owners = await db.Users.AsNoTracking().Where(u => u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner))
            .Select(u => u.Id).Distinct().ToArrayAsync(t);
        var periodic = compact.Set<BHome.Domain.Billing.OperationalTask>().FromSqlRaw("""
            SELECT * FROM operational_tasks WHERE task_type='METER_READ'
                AND task_data->'state'->>'purpose'='1' AND status NOT IN ('2','3')
            """).AsNoTracking();
        var tasks = await (from task in periodic
                           join location in compact.Set<BHome.Domain.Locations.Location>().AsNoTracking() on task.StoredLocationId equals location.Id
                           join meter in compact.Set<BHome.Domain.Billing.Meter>().AsNoTracking() on task.MeterId equals meter.Id
                           join room in compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on meter.RoomId equals room.Id
                           where location.IsActive && task.BillingPeriod != null && task.DueAt < now
                           select new { task.Id, LocationId = location.Id, location.Name, meter.RoomId, room.RoomNumber, task.BillingPeriod, task.DueAt }).ToArrayAsync(t);
        foreach (var group in tasks.GroupBy(task => new { task.LocationId, task.Name, task.BillingPeriod }))
        {
            var location = group.Key.LocationId;
            var staff = (await NativeBillingJobPersistence.AssignmentsAsync(compact, location, today, t))
                .Select(a => (Guid?)a.StaffUserId).SingleOrDefault();
            var period = group.Key.BillingPeriod!.Value;
            var rooms = group.GroupBy(task => task.RoomId).Select(room => room.First().RoomNumber).OrderBy(name => name).ToArray();
            var deadline = group.Min(task => task.DueAt)!.Value.ToOffset(TimeSpan.FromHours(7));
            var taskId = group.OrderBy(task => task.DueAt).ThenBy(task => task.Id).First().Id;
            var key = $"periodic-meter-overdue:{location:N}:{period:yyyyMM}:{staff?.ToString("N") ?? "unassigned"}";
            var title = "Ghi chỉ số định kỳ quá hạn";
            var body = $"Cơ sở {group.Key.Name}, kỳ {period:MM/yyyy}: {rooms.Length} phòng chưa hoàn tất ghi điện nước. Hạn ghi: {deadline:HH:mm dd/MM/yyyy}. Phòng: {string.Join(", ", rooms)}.";
            var staffName = "Chưa được phân công";
            if (staff is { } staffId)
            {
                var users = db.Users.AsNoTracking().Where(user => user.Id == staffId);
                staffName = db.Model.FindEntityType(typeof(ApplicationUser))?.FindProperty("full_name") is not null
                    ? await users.Select(user => EF.Property<string>(user, "full_name") ?? user.UserName).SingleOrDefaultAsync(t) ?? "Nhân viên"
                    : await users.Select(user => user.UserName).SingleOrDefaultAsync(t) ?? "Nhân viên";
            }
            foreach (var owner in owners)
                await sql.Emit(owner, Roles.Owner, location, key, "PERIODIC_METER_OVERDUE", "Task", title, $"Nhân viên: {staffName}. {body}", "MeterTask", taskId, t, channels: ["IN_APP"]);
            if (staff is { } recipient && (await NativeBillingJobPersistence.AssignmentsAsync(compact, location, today, t))
                .Any(a => a.StaffUserId == recipient))
                await sql.Emit(recipient, Roles.Staff, location, key, "PERIODIC_METER_OVERDUE", "Task", title, body, "MeterTask", taskId, t, channels: ["IN_APP", "EMAIL"]);
        }
    }
}
