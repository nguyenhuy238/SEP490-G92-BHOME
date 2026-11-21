using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureScope(BHomePersistenceContext db, ICurrentUser user, TimeProvider clock)
{
    public Guid UserId => user.UserId ?? Guid.Empty;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
    private IQueryable<Guid> EligibleStaff => db is Compact24DbContext compact
        ? StaffEmploymentEligibility.EligibleIds(compact, Today)
        : db.Users.Where(u => u.IsActive).Select(u => u.Id);
    public IQueryable<Location> VisibleLocations => db.Locations.Where(l => l.IsActive &&
        (user.IsInRole(Roles.Owner) ||
        (user.IsInRole(Roles.Staff) && EligibleStaff.Contains(UserId) && db.StaffLocationAssignments.Any(a => a.LocationId == l.Id && a.StaffUserId == UserId &&
            a.StartDate <= Today && a.EndDate >= Today))));
    public IQueryable<Room> VisibleRooms => db.Set<Room>().Where(r => VisibleLocations.Any(l => l.Id == r.LocationId));
    public IQueryable<OperationalTask> VisibleTasks => db.Set<OperationalTask>()
        .Where(t => t.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && VisibleRooms.Any(r => r.Id == t.Meter.RoomId) &&
            (t.AutomationPlanId == null || user.IsInRole(Roles.Owner) || t.AssignedStaffUserId == UserId));
}
