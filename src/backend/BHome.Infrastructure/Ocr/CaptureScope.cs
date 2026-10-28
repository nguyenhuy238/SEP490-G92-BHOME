using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureScope(BHomeDbContext db, ICurrentUser user, TimeProvider clock) : IStaffLocationAccess
{
    public Guid UserId => user.UserId ?? Guid.Empty;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
    public IQueryable<Location> VisibleLocations => db.Set<Location>().Where(l => l.IsActive &&
        ((user.IsInRole(Roles.Owner) && l.Chain.OwnerUserId == UserId) ||
        (user.IsInRole(Roles.Staff) && db.Set<StaffLocationAssignment>().Any(a => a.LocationId == l.Id && a.StaffUserId == UserId &&
            a.EffectiveFrom <= Today && (a.EffectiveTo == null || a.EffectiveTo >= Today) &&
            db.Users.Any(u => u.Id == UserId && u.ManagingOwnerId == l.Chain.OwnerUserId)))));
    public IQueryable<Room> VisibleRooms => db.Set<Room>().Where(r => VisibleLocations.Any(l => l.Id == r.LocationId));
    public IQueryable<OperationalTask> VisibleTasks => db.Set<OperationalTask>().Where(t => VisibleRooms.Any(r => r.Id == t.Meter.RoomId) &&
        (user.IsInRole(Roles.Owner) || t.AssignedStaffUserId == UserId));
    public Task<bool> IsAssignedAsync(Guid staffId, Guid ownerId, Guid locationId, CancellationToken token)
        => db.Set<StaffLocationAssignment>().AnyAsync(a => a.StaffUserId == staffId && a.LocationId == locationId &&
            a.Location.IsActive && a.Location.Chain.OwnerUserId == ownerId && a.EffectiveFrom <= Today &&
            (a.EffectiveTo == null || a.EffectiveTo >= Today) && db.Users.Any(u => u.Id == staffId && u.IsActive && u.ManagingOwnerId == ownerId), token);
}
