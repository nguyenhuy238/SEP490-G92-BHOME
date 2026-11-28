using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("invoice_adjustments", Schema = "public")]
public sealed class InvoiceAdjustment
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("invoice_id", TypeName = "uuid")]
    public Guid InvoiceId { get; set; }

    [Column("requested_by_user_id", TypeName = "uuid")]
    public Guid RequestedByUserId { get; set; }

    [Column("requested_at", TypeName = "timestamptz")]
    public DateTimeOffset RequestedAt { get; set; }

    [Column("reason", TypeName = "text")]
    public string Reason { get; set; } = null!;

    [Column("request_snapshot", TypeName = "jsonb")]
    public JsonElement RequestSnapshot { get; set; }

    [Column("proposed_changes", TypeName = "jsonb")]
    public JsonElement ProposedChanges { get; set; }

    [Column("evidence", TypeName = "jsonb")]
    public JsonElement Evidence { get; set; }

    [Column("status", TypeName = "varchar(12)")]
    public string Status { get; set; } = null!;

    [Column("approved_delta_amount", TypeName = "numeric(18,0)")]
    public decimal? ApprovedDeltaAmount { get; set; }

    [Column("decided_by_user_id", TypeName = "uuid")]
    public Guid? DecidedByUserId { get; set; }

    [Column("decided_at", TypeName = "timestamptz")]
    public DateTimeOffset? DecidedAt { get; set; }

    [Column("decision_reason", TypeName = "text")]
    public string? DecisionReason { get; set; }

    [Column("decision_snapshot", TypeName = "jsonb")]
    public JsonElement? DecisionSnapshot { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
