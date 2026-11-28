using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

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
    public string ContractSettings { get; set; } = "[]";

    // Physical JSON columns are mapped by the Compact24 runtime only.
    // The archive model maps the historical business projection separately.
    [NotMapped, JsonIgnore] public JsonElement StaffAssignments { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public JsonElement OperatingSettings { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement PublicProfile { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public DateTimeOffset? PublishedAt { get; set; }
    [NotMapped, JsonIgnore] public Guid? PublishedByUserId { get; set; }
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
