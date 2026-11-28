using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("payments", Schema = "public")]
public sealed class Payment
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("provider_code", TypeName = "varchar(80)")]
    public string ProviderCode { get; set; } = null!;

    [Column("receiving_account_key", TypeName = "varchar(200)")]
    public string ReceivingAccountKey { get; set; } = null!;

    [Column("transaction_reference", TypeName = "varchar(150)")]
    public string TransactionReference { get; set; } = null!;

    [Column("effect_key", TypeName = "varchar(250)")]
    public string? EffectKey { get; set; }

    [Column("received_at", TypeName = "timestamptz")]
    public DateTimeOffset ReceivedAt { get; set; }

    [Column("amount", TypeName = "numeric(18,0)")]
    public decimal Amount { get; set; }

    [Column("currency", TypeName = "varchar(3)")]
    public string Currency { get; set; } = null!;

    [Column("remittance_info", TypeName = "text")]
    public string? RemittanceInfo { get; set; }

    [Column("beneficiary_resident_id", TypeName = "uuid")]
    public Guid? BeneficiaryResidentId { get; set; }

    [Column("status", TypeName = "varchar(12)")]
    public string Status { get; set; } = null!;

    [Column("verification_method", TypeName = "varchar(10)")]
    public string? VerificationMethod { get; set; }

    [Column("verified_by_user_id", TypeName = "uuid")]
    public Guid? VerifiedByUserId { get; set; }

    [Column("verified_at", TypeName = "timestamptz")]
    public DateTimeOffset? VerifiedAt { get; set; }

    [Column("verification_data", TypeName = "jsonb")]
    public JsonElement VerificationData { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
