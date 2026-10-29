using BHome.Domain.Common;

namespace BHome.Domain.Locations;

public sealed class StaffLocationAssignment : AuditableEntity
{
    private StaffLocationAssignment() { }

    public StaffLocationAssignment(Guid locationId, Guid staffUserId, Guid createdByUserId,
        DateOnly startDate, DateOnly endDate)
    {
        LocationId = locationId;
        StaffUserId = staffUserId;
        CreatedByUserId = createdByUserId;
        StartDate = startDate;
        EndDate = endDate;
    }

    public Guid LocationId { get; private set; }
    public Guid StaffUserId { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public DateOnly StartDate { get; private set; }
    public DateOnly EndDate { get; private set; }
}
