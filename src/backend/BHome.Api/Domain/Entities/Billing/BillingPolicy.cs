using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("billing_policies", Schema = "public")]
public sealed class BillingPolicy
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid? RoomId { get; set; }

    [Column("charge_code", TypeName = "varchar(80)")]
    public string ChargeCode { get; set; } = null!;

    [Column("category", TypeName = "smallint")]
    public short Category { get; set; }

    [Column("calculation_method", TypeName = "varchar(30)")]
    public string CalculationMethod { get; set; } = null!;

    [Column("rate", TypeName = "numeric(18,4)")]
    public decimal Rate { get; set; }

    [Column("parameters", TypeName = "jsonb")]
    public JsonElement Parameters { get; set; }

    [Column("effective_from", TypeName = "date")]
    public DateOnly EffectiveFrom { get; set; }

    [Column("effective_to", TypeName = "date")]
    public DateOnly? EffectiveTo { get; set; }

    [Column("first_used_at", TypeName = "timestamptz")]
    public DateTimeOffset? FirstUsedAt { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
