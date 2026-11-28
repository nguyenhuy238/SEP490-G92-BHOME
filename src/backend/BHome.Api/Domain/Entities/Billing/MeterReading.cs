using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("meter_readings", Schema = "public")]
public sealed class MeterReading
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("meter_id", TypeName = "uuid")]
    public Guid MeterId { get; set; }

    [Column("operational_task_id", TypeName = "uuid")]
    public Guid OperationalTaskId { get; set; }

    [Column("reading_purpose", TypeName = "smallint")]
    public short ReadingPurpose { get; set; }

    [Column("billing_period", TypeName = "date")]
    public DateOnly? BillingPeriod { get; set; }

    [Column("reading_at", TypeName = "timestamptz")]
    public DateTimeOffset ReadingAt { get; set; }

    [Column("previous_value", TypeName = "numeric(18,4)")]
    public decimal? PreviousValue { get; set; }

    [Column("ocr_proposed_value", TypeName = "numeric(18,4)")]
    public decimal? OcrProposedValue { get; set; }

    [Column("confirmed_value", TypeName = "numeric(18,4)")]
    public decimal ConfirmedValue { get; set; }

    [Column("consumption", TypeName = "numeric(18,4)")]
    public decimal? Consumption { get; set; }

    [Column("confirmed_by_user_id", TypeName = "uuid")]
    public Guid ConfirmedByUserId { get; set; }

    [Column("confirmed_at", TypeName = "timestamptz")]
    public DateTimeOffset ConfirmedAt { get; set; }

    [Column("evidence", TypeName = "jsonb")]
    public JsonElement Evidence { get; set; }

    [Column("status", TypeName = "smallint")]
    public short Status { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
