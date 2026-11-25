using BHome.Application.Common;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Billing;

internal sealed class BillingMeterOverdueNotifier(BHomePersistenceContext db, TimeProvider clock, CompactNotificationWriter? sql = null)
{
    internal async Task NotifyAsync(CancellationToken t)
    {
        if (sql is null) return; // Legacy source-schema fixture does not use Compact24 notifications.
        var now = clock.BusinessUtcNow();
        var today = clock.BusinessToday();
        var owners = await (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId
                            join role in db.Roles on grant.RoleId equals role.Id
                            where u.IsActive && role.Name == Roles.Owner select u.Id).Distinct().ToArrayAsync(t);
        var eligibleStaff = db is Compact24DbContext compact ? StaffEmploymentEligibility.EligibleIds(compact, today) :
            (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join role in db.Roles on grant.RoleId equals role.Id where u.IsActive && role.Name == Roles.Staff select u.Id);
        var tasks = await db.Set<OperationalTask>().AsNoTracking()
            .Where(x => x.Kind == OperationalTaskKind.MeterReading && x.Purpose == ReadingPurpose.Periodic && x.BillingPeriod != null &&
                x.Location.IsActive && x.DueAt < now && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled)
            .Select(x => new { x.Id, x.LocationId, x.Location.Name, x.Meter.RoomId, x.Meter.Room.RoomNumber, x.BillingPeriod, x.DueAt, x.AssignedStaffUserId })
            .ToArrayAsync(t);
        foreach (var group in tasks.GroupBy(task => new { task.LocationId, task.Name, task.BillingPeriod, task.AssignedStaffUserId }))
        {
            var location = group.Key.LocationId;
            var staff = group.Key.AssignedStaffUserId;
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
            if (staff is { } recipient && await db.StaffLocationAssignments.AnyAsync(a =>
                    a.LocationId == location && a.StaffUserId == recipient && a.StartDate <= today && a.EndDate >= today && eligibleStaff.Contains(a.StaffUserId), t))
                await sql.Emit(recipient, Roles.Staff, location, key, "PERIODIC_METER_OVERDUE", "Task", title, body, "MeterTask", taskId, t, channels: ["IN_APP", "EMAIL"]);
        }
    }
}
