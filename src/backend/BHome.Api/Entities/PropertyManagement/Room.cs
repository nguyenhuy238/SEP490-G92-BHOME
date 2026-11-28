using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public sealed class Room : AuditableEntity
{
    public Guid LocationId { get; set; }
    public BHome.Domain.Locations.Location Location { get; set; } = null!;
    public string RoomNumber { get; set; } = "";
    // Nullable only for pre-existing OCR workspace records awaiting Owner configuration.
    public Guid? RoomTypeId { get; set; }
    public RoomType? RoomType { get; set; }
    public string? Floor { get; set; }
    public int Capacity { get; set; } = 1;
    public RoomStatus Status { get; set; } = RoomStatus.Unavailable;
    public int Version { get; set; } = 1;
    [NotMapped, JsonIgnore] public JsonElement BillingRepresentatives { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public JsonElement PublicProfile { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public DateTimeOffset? PublishedAt { get; set; }
    [NotMapped, JsonIgnore] public Guid? PublishedByUserId { get; set; }
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
