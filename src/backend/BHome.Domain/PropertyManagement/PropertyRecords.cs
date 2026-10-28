using BHome.Domain.Common;

namespace BHome.Domain.PropertyManagement;

public sealed class Chain : AuditableEntity
{
    public Guid OwnerUserId { get; set; }
    public string Name { get; set; } = "";
}
public sealed class Location : AuditableEntity
{
    public Guid ChainId { get; set; }
    public Chain Chain { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
public sealed class Room : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Location Location { get; set; } = null!;
    public string RoomNumber { get; set; } = "";
}
