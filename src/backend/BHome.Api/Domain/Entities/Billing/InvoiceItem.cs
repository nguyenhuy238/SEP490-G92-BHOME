using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("invoice_items", Schema = "public")]
public sealed class InvoiceItem
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("invoice_id", TypeName = "uuid")]
    public Guid InvoiceId { get; set; }

    [Column("charge_code", TypeName = "varchar(80)")]
    public string ChargeCode { get; set; } = null!;

    [Column("description", TypeName = "varchar(255)")]
    public string Description { get; set; } = null!;

    [Column("billing_policy_id", TypeName = "uuid")]
    public Guid? BillingPolicyId { get; set; }

    [Column("meter_reading_id", TypeName = "uuid")]
    public Guid? MeterReadingId { get; set; }

    [Column("quantity", TypeName = "numeric(18,4)")]
    public decimal Quantity { get; set; }

    [Column("unit_price", TypeName = "numeric(18,4)")]
    public decimal UnitPrice { get; set; }

    [Column("amount", TypeName = "numeric(18,0)")]
    public decimal Amount { get; set; }

    [Column("calculation_snapshot", TypeName = "jsonb")]
    public JsonElement CalculationSnapshot { get; set; }
}
