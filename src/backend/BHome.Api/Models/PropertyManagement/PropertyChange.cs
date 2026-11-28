using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

// Configuration snapshots contain no resident identity or credentials. Inserts only.
public sealed class PropertyChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActorId { get; set; }
    public Guid? LocationId { get; set; }
    public Guid TargetId { get; set; }
    public string TargetType { get; set; } = "";
    public string Action { get; set; } = "";
    public string Reason { get; set; } = "";
    public string? Before { get; set; }
    public string After { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}
