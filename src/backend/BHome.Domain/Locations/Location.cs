using BHome.Domain.Common;

namespace BHome.Domain.Locations;

public sealed class Location : AuditableEntity
{
    private Location() { }

    public Location(string name)
    {
        Name = name;
    }

    public string Name { get; private set; } = "";
}
