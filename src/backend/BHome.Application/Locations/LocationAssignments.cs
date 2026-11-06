namespace BHome.Application.Locations;

public sealed record LocationSummary(Guid Id, string Name);
public sealed record StaffAssignmentSummary(Guid Id, Guid StaffUserId, DateOnly StartDate, DateOnly EndDate);

public enum CreateAssignmentStatus
{
    Created,
    InvalidDateRange,
    LocationNotFound,
    StaffUnavailable,
    DateRangeOverlaps
}

public sealed record CreateAssignmentResult(CreateAssignmentStatus Status, StaffAssignmentSummary? Assignment = null);
public enum ChangeAssignmentStatus { Changed, Invalid, LocationNotFound, StaffUnavailable, StaleVersion, NoCurrentAssignment }
public sealed record ChangeAssignmentResult(ChangeAssignmentStatus Status, StaffAssignmentSummary? Assignment = null, int? LocationVersion = null);

public interface ILocationAssignments
{
    Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffUserId, DateOnly effectiveDate,
        CancellationToken cancellationToken);
    Task<CreateAssignmentResult> CreateAssignmentAsync(Guid createdByUserId, Guid locationId, Guid staffUserId,
        DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken);
    Task<IReadOnlyList<StaffAssignmentSummary>?> ListAssignmentsAsync(Guid locationId, CancellationToken cancellationToken);
    Task<ChangeAssignmentResult> ReplaceAssignmentAsync(Guid actorId, Guid locationId, Guid staffUserId,
        DateOnly effectiveFrom, int expectedLocationVersion, string reason, CancellationToken cancellationToken);
    Task<ChangeAssignmentResult> RemoveAssignmentAsync(Guid actorId, Guid locationId, DateOnly effectiveFrom,
        int expectedLocationVersion, string reason, CancellationToken cancellationToken);
}
