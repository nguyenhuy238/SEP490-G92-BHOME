using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("operational_tasks", Schema = "public")]
public sealed class OperationalTask
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("task_type", TypeName = "varchar(20)")]
    public string TaskType { get; set; } = null!;

    [Column("location_id", TypeName = "uuid")]
    public Guid? LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid? RoomId { get; set; }

    [Column("asset_id", TypeName = "uuid")]
    public Guid? AssetId { get; set; }

    [Column("assigned_user_id", TypeName = "uuid")]
    public Guid? AssignedUserId { get; set; }

    [Column("contract_id", TypeName = "uuid")]
    public Guid? ContractId { get; set; }

    [Column("incident_report_id", TypeName = "uuid")]
    public Guid? IncidentReportId { get; set; }

    [Column("meter_id", TypeName = "uuid")]
    public Guid? MeterId { get; set; }

    [Column("billing_period", TypeName = "date")]
    public DateOnly? BillingPeriod { get; set; }

    [Column("source_key", TypeName = "varchar(250)")]
    public string? SourceKey { get; set; }

    [Column("title", TypeName = "varchar(200)")]
    public string? Title { get; set; }

    [Column("description", TypeName = "text")]
    public string? Description { get; set; }

    [Column("priority", TypeName = "varchar(12)")]
    public string? Priority { get; set; }

    [Column("status", TypeName = "varchar(30)")]
    public string Status { get; set; } = null!;

    [Column("assigned_at", TypeName = "timestamptz")]
    public DateTimeOffset? AssignedAt { get; set; }

    [Column("starts_at", TypeName = "timestamptz")]
    public DateTimeOffset? StartsAt { get; set; }

    [Column("ends_at", TypeName = "timestamptz")]
    public DateTimeOffset? EndsAt { get; set; }

    [Column("due_at", TypeName = "timestamptz")]
    public DateTimeOffset? DueAt { get; set; }

    [Column("next_run_at", TypeName = "timestamptz")]
    public DateTimeOffset? NextRunAt { get; set; }

    [Column("locked_until", TypeName = "timestamptz")]
    public DateTimeOffset? LockedUntil { get; set; }

    [Column("lease_token", TypeName = "uuid")]
    public Guid? LeaseToken { get; set; }

    [Column("attempt_count", TypeName = "integer")]
    public int AttemptCount { get; set; }

    [Column("task_data", TypeName = "jsonb")]
    public JsonElement TaskData { get; set; }

    [Column("evidence", TypeName = "jsonb")]
    public JsonElement Evidence { get; set; }

    [Column("estimated_cost", TypeName = "numeric(18,0)")]
    public decimal? EstimatedCost { get; set; }

    [Column("approved_cost", TypeName = "numeric(18,0)")]
    public decimal? ApprovedCost { get; set; }

    [Column("cost_approved_by_user_id", TypeName = "uuid")]
    public Guid? CostApprovedByUserId { get; set; }

    [Column("cost_approved_at", TypeName = "timestamptz")]
    public DateTimeOffset? CostApprovedAt { get; set; }

    [Column("verified_by_user_id", TypeName = "uuid")]
    public Guid? VerifiedByUserId { get; set; }

    [Column("verified_at", TypeName = "timestamptz")]
    public DateTimeOffset? VerifiedAt { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
