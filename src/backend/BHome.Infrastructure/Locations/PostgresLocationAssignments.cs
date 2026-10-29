using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Locations;

internal sealed class PostgresLocationAssignments(BHomeDbContext db) : ILocationAssignments, IStaffLocationAccess
{
    public async Task<LocationSummary> CreateLocationAsync(string name, CancellationToken cancellationToken)
    {
        var location = new Location(name);
        db.Locations.Add(location);
        await db.SaveChangesAsync(cancellationToken);
        return new LocationSummary(location.Id, location.Name);
    }

    public async Task<IReadOnlyList<LocationSummary>> ListLocationsAsync(CancellationToken cancellationToken) =>
        await db.Locations.AsNoTracking()
            .OrderBy(x => x.Name).ThenBy(x => x.Id)
            .Select(x => new LocationSummary(x.Id, x.Name)).ToArrayAsync(cancellationToken);

    public async Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffUserId,
        DateOnly effectiveDate, CancellationToken cancellationToken) =>
        await db.StaffLocationAssignments.AsNoTracking()
            .Where(x => x.StaffUserId == staffUserId && x.StartDate <= effectiveDate && effectiveDate <= x.EndDate)
            .Join(db.Locations.AsNoTracking(), assignment => assignment.LocationId, location => location.Id,
                (_, location) => location)
            .OrderBy(x => x.Name).ThenBy(x => x.Id)
            .Select(x => new LocationSummary(x.Id, x.Name)).ToArrayAsync(cancellationToken);

    public async Task<CreateAssignmentResult> CreateAssignmentAsync(Guid createdByUserId, Guid locationId,
        Guid staffUserId, DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken)
    {
        if (createdByUserId == Guid.Empty || locationId == Guid.Empty || staffUserId == Guid.Empty || startDate > endDate)
            return new(CreateAssignmentStatus.InvalidDateRange);
        if (!await db.Locations.AsNoTracking().AnyAsync(x => x.Id == locationId, cancellationToken))
            return new(CreateAssignmentStatus.LocationNotFound);

        var staffRoleId = await db.Roles.AsNoTracking().Where(x => x.NormalizedName == Roles.Staff.ToUpper())
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync(cancellationToken);
        var availableStaff = staffRoleId is { } roleId && await db.Users.AsNoTracking()
            .AnyAsync(x => x.Id == staffUserId && x.IsActive &&
                db.UserRoles.Any(role => role.UserId == x.Id && role.RoleId == roleId), cancellationToken);
        if (!availableStaff) return new(CreateAssignmentStatus.StaffUnavailable);

        var overlaps = await db.StaffLocationAssignments.AsNoTracking().AnyAsync(x =>
            x.LocationId == locationId && x.StartDate <= endDate && startDate <= x.EndDate, cancellationToken);
        if (overlaps) return new(CreateAssignmentStatus.DateRangeOverlaps);

        var assignment = new StaffLocationAssignment(locationId, staffUserId, createdByUserId, startDate, endDate);
        db.StaffLocationAssignments.Add(assignment);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: "23P01" })
        {
            db.Entry(assignment).State = EntityState.Detached;
            return new(CreateAssignmentStatus.DateRangeOverlaps);
        }
        return new(CreateAssignmentStatus.Created,
            new StaffAssignmentSummary(assignment.Id, assignment.StaffUserId, assignment.StartDate, assignment.EndDate));
    }

    public async Task<IReadOnlyList<StaffAssignmentSummary>?> ListAssignmentsAsync(Guid locationId,
        CancellationToken cancellationToken)
    {
        if (!await db.Locations.AsNoTracking().AnyAsync(x => x.Id == locationId, cancellationToken)) return null;
        return await db.StaffLocationAssignments.AsNoTracking().Where(x => x.LocationId == locationId)
            .OrderByDescending(x => x.StartDate).ThenBy(x => x.Id)
            .Select(x => new StaffAssignmentSummary(x.Id, x.StaffUserId, x.StartDate, x.EndDate))
            .ToArrayAsync(cancellationToken);
    }

    public Task<bool> IsAssignedAsync(Guid staffId, Guid locationId, CancellationToken cancellationToken)
    {
        var today = BusinessDate.Today();
        return db.StaffLocationAssignments.AsNoTracking().AnyAsync(x => x.StaffUserId == staffId &&
            x.LocationId == locationId && x.StartDate <= today && today <= x.EndDate, cancellationToken);
    }
}

internal static class BusinessDate
{
    private static readonly TimeZoneInfo Vietnam = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    public static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Vietnam).DateTime);
}
