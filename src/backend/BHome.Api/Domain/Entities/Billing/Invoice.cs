using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("invoices", Schema = "public")]
public sealed class Invoice
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid RoomId { get; set; }

    [Column("contract_id", TypeName = "uuid")]
    public Guid ContractId { get; set; }

    [Column("representative_tenant_user_id", TypeName = "uuid")]
    public Guid RepresentativeTenantUserId { get; set; }

    [Column("invoice_type", TypeName = "varchar(12)")]
    public string InvoiceType { get; set; } = null!;

    [Column("billing_period", TypeName = "date")]
    public DateOnly BillingPeriod { get; set; }

    [Column("recipient_user_ids", TypeName = "uuid[]")]
    public Guid[] RecipientUserIds { get; set; } = null!;

    [Column("base_total_amount", TypeName = "numeric(18,0)")]
    public decimal BaseTotalAmount { get; set; }

    [Column("status", TypeName = "smallint")]
    public short Status { get; set; }

    [Column("missing_inputs", TypeName = "text[]")]
    public string[] MissingInputs { get; set; } = null!;

    [Column("billing_snapshot", TypeName = "jsonb")]
    public JsonElement BillingSnapshot { get; set; }

    [Column("payment_requests", TypeName = "jsonb")]
    public JsonElement PaymentRequests { get; set; }

    [Column("scheduled_final_date", TypeName = "date")]
    public DateOnly ScheduledFinalDate { get; set; }

    [Column("due_date", TypeName = "date")]
    public DateOnly DueDate { get; set; }

    [Column("finalized_at", TypeName = "timestamptz")]
    public DateTimeOffset? FinalizedAt { get; set; }

    [Column("finalized_by_user_id", TypeName = "uuid")]
    public Guid? FinalizedByUserId { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
