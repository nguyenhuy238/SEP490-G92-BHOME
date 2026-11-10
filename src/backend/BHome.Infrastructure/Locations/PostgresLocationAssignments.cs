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
    // Legacy-schema test adapter. The running Compact24 application uses CompactLocationAssignments,
    // where replacement also reassigns open tasks in one transaction.
    public Task<ChangeAssignmentResult> ReplaceAssignmentAsync(Guid actorId, Guid locationId, Guid staffUserId,
        DateOnly effectiveFrom, int expectedLocationVersion, string reason, CancellationToken cancellationToken) =>
        Task.FromResult(new ChangeAssignmentResult(ChangeAssignmentStatus.Invalid));

    public Task<ChangeAssignmentResult> RemoveAssignmentAsync(Guid actorId, Guid locationId, DateOnly effectiveFrom,
        int expectedLocationVersion, string reason, CancellationToken cancellationToken) =>
        Task.FromResult(new ChangeAssignmentResult(ChangeAssignmentStatus.Invalid));

    public async Task<UpdateAssignmentPeriodResult> UpdateAssignmentPeriodAsync(Guid actorId, Guid assignmentId,
        DateOnly startDate, DateOnly endDate, int expectedLocationVersion, string reason, CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty || assignmentId == Guid.Empty || startDate > endDate || expectedLocationVersion < 1 ||
            string.IsNullOrWhiteSpace(reason)) return new(UpdateAssignmentPeriodStatus.Invalid);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var assignment = await db.StaffLocationAssignments.SingleOrDefaultAsync(x => x.Id == assignmentId, cancellationToken);
        if (assignment is null) return new(UpdateAssignmentPeriodStatus.AssignmentNotFound);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({assignment.LocationId.ToString()}, 0))", cancellationToken);
        var location = await db.Locations.SingleAsync(x => x.Id == assignment.LocationId, cancellationToken);
        if (location.Version != expectedLocationVersion)
            return new(UpdateAssignmentPeriodStatus.StaleVersion, LocationVersion: location.Version);
        var today = BusinessDate.Today();
        var isCurrent = assignment.StartDate <= today && today <= assignment.EndDate;
        if (assignment.EndDate < today || isCurrent && (startDate > today || endDate < today))
            return new(UpdateAssignmentPeriodStatus.Invalid);
        if (await db.StaffLocationAssignments.AsNoTracking().AnyAsync(x => x.LocationId == assignment.LocationId &&
            x.Id != assignmentId && x.StartDate <= endDate && startDate <= x.EndDate, cancellationToken))
            return new(UpdateAssignmentPeriodStatus.DateRangeOverlaps);
        assignment.ChangePeriod(startDate, endDate);
        location.Version++;
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: "23P01" })
        { return new(UpdateAssignmentPeriodStatus.DateRangeOverlaps); }
        await transaction.CommitAsync(cancellationToken);
        return new(UpdateAssignmentPeriodStatus.Changed,
            new(assignment.Id, assignment.StaffUserId, assignment.StartDate, assignment.EndDate), location.Version);
    }

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
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Use the same Location lock/order as property configuration. Concurrent GiST exclusion
        // checks can deadlock (40P01); serialize before re-reading eligibility and overlapping dates.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", cancellationToken);
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
        await transaction.CommitAsync(cancellationToken);
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

    public async Task<IReadOnlyList<StaffAssignmentDetail>> ListStaffAssignmentsAsync(Guid staffUserId,
        CancellationToken cancellationToken) =>
        await db.StaffLocationAssignments.AsNoTracking()
            .Where(x => x.StaffUserId == staffUserId)
            .Join(db.Locations.AsNoTracking(), assignment => assignment.LocationId, location => location.Id,
                (assignment, location) => new StaffAssignmentDetail(assignment.Id, assignment.StaffUserId,
                    location.Id, location.Name, assignment.StartDate, assignment.EndDate))
            .OrderByDescending(x => x.StartDate).ThenBy(x => x.LocationName).ThenBy(x => x.Id)
            .ToArrayAsync(cancellationToken);

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
