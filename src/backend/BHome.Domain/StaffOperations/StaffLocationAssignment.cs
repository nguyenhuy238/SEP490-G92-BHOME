using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.StaffOperations;

public sealed class StaffLocationAssignment : AuditableEntity
{
    public Guid StaffUserId { get; set; }
    public Guid LocationId { get; set; }
    public Location Location { get; set; } = null!;
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
}
