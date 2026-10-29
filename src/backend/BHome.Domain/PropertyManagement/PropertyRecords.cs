using BHome.Domain.Common;

namespace BHome.Domain.PropertyManagement;

public sealed class Chain : AuditableEntity
{
    public string Name { get; set; } = "";
}
public sealed class Room : AuditableEntity
{
    public Guid LocationId { get; set; }
    public BHome.Domain.Locations.Location Location { get; set; } = null!;
    public string RoomNumber { get; set; } = "";
}
