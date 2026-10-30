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

public interface ILocationAssignments
{
    Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffUserId, DateOnly effectiveDate,
        CancellationToken cancellationToken);
    Task<CreateAssignmentResult> CreateAssignmentAsync(Guid createdByUserId, Guid locationId, Guid staffUserId,
        DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken);
    Task<IReadOnlyList<StaffAssignmentSummary>?> ListAssignmentsAsync(Guid locationId, CancellationToken cancellationToken);
}
