using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public sealed class Asset : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string? CommonArea { get; set; }
    public string? Code { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Condition { get; set; } = "";
    public AssetStatus Status { get; set; }
    public int Version { get; set; } = 1;
    [NotMapped, JsonIgnore] public JsonElement PurchaseMetadata { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
