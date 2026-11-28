using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.IncidentMaintenance;

public sealed class IncidentReport : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string? CommonArea { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? ContractId { get; set; }
    [NotMapped, JsonIgnore] public Guid ReporterUserId { get; set; }
    public Guid ReporterId { get => ReporterUserId; set => ReporterUserId = value; }
    public string ReporterRole { get; set; } = "";
    public string Description { get; set; } = "";
    public IncidentSeverity Severity { get; set; }
    public IncidentStatus Status { get; set; }
    public string? Type { get; set; }
    public string? Category { get; set; }
    [NotMapped, JsonIgnore] public Guid? DuplicateOfReportId { get; set; }
    public Guid? DuplicateOfId { get => DuplicateOfReportId; set => DuplicateOfReportId = value; }
    public Guid? AcknowledgedById { get; set; }
    public DateTimeOffset? AcknowledgedAt { get; set; }
    public DateTimeOffset? OwnerDecisionAt { get; set; }
    public string? ResolutionNote { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public int Version { get; set; } = 1;
    public bool IsOpen => Status is IncidentStatus.Submitted or IncidentStatus.InProgress;

    // Physical report metadata, excluded from historical business snapshots.
    [NotMapped, JsonIgnore] public DateTimeOffset ReportedAt { get => CreatedAt; set => CreatedAt = value; }
    [NotMapped, JsonIgnore] public string Summary { get; set; } = "";
    [NotMapped, JsonIgnore] public JsonElement Evidence { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public JsonElement EmergencyActions { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public JsonElement OwnerDecision { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());

    public static bool CanResolve(IReadOnlyCollection<WorkOrderStatus> states) =>
        states.Count > 0 && states.Any(s => s == WorkOrderStatus.Verified) &&
        states.All(s => s is WorkOrderStatus.Verified or WorkOrderStatus.Cancelled);
}
