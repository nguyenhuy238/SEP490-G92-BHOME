using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("incident_reports", Schema = "public")]
public sealed class IncidentReport
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid? RoomId { get; set; }

    [Column("asset_id", TypeName = "uuid")]
    public Guid? AssetId { get; set; }

    [Column("reporter_user_id", TypeName = "uuid")]
    public Guid ReporterUserId { get; set; }

    [Column("severity", TypeName = "varchar(12)")]
    public string Severity { get; set; } = null!;

    [Column("summary", TypeName = "varchar(250)")]
    public string Summary { get; set; } = null!;

    [Column("description", TypeName = "text")]
    public string Description { get; set; } = null!;

    [Column("status", TypeName = "varchar(30)")]
    public string Status { get; set; } = null!;

    [Column("evidence", TypeName = "jsonb")]
    public JsonElement Evidence { get; set; }

    [Column("emergency_actions", TypeName = "jsonb")]
    public JsonElement EmergencyActions { get; set; }

    [Column("duplicate_of_report_id", TypeName = "uuid")]
    public Guid? DuplicateOfReportId { get; set; }

    [Column("owner_decision", TypeName = "jsonb")]
    public JsonElement OwnerDecision { get; set; }

    [Column("reported_at", TypeName = "timestamptz")]
    public DateTimeOffset ReportedAt { get; set; }

    [Column("resolved_at", TypeName = "timestamptz")]
    public DateTimeOffset? ResolvedAt { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
