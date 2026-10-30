using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Locations;

public sealed class Location : AuditableEntity
{
    private Location() { }

    public Location(string name)
    {
        Name = name;
    }

    public Guid? ChainId { get; set; }
    public Chain? Chain { get; set; }
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
}
