using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureScope(BHomeDbContext db, ICurrentUser user, TimeProvider clock)
{
    public Guid UserId => user.UserId ?? Guid.Empty;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
    public IQueryable<Location> VisibleLocations => db.Locations.Where(l => l.IsActive &&
        (user.IsInRole(Roles.Owner) ||
        (user.IsInRole(Roles.Staff) && db.StaffLocationAssignments.Any(a => a.LocationId == l.Id && a.StaffUserId == UserId &&
            a.StartDate <= Today && a.EndDate >= Today))));
    public IQueryable<Room> VisibleRooms => db.Set<Room>().Where(r => VisibleLocations.Any(l => l.Id == r.LocationId));
    public IQueryable<OperationalTask> VisibleTasks => db.Set<OperationalTask>()
        .Where(t => t.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && VisibleRooms.Any(r => r.Id == t.Meter.RoomId));
}
