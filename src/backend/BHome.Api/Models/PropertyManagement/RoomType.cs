using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public sealed class RoomType : AuditableEntity
{
    public Guid LocationId { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int DefaultCapacity { get; set; } = 1;
    public decimal? AreaM2 { get; set; }
    public string[] Amenities { get; set; } = [];
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
}
