using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("refund_requests", Schema = "public")]
public sealed class RefundRequest
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("source_payment_id", TypeName = "uuid")]
    public Guid? SourcePaymentId { get; set; }

    [Column("source_deposit_contract_id", TypeName = "uuid")]
    public Guid? SourceDepositContractId { get; set; }

    [Column("beneficiary_resident_id", TypeName = "uuid")]
    public Guid? BeneficiaryResidentId { get; set; }

    [Column("beneficiary_kind", TypeName = "varchar(12)")]
    public string BeneficiaryKind { get; set; } = null!;

    [Column("external_payer_attestation_id", TypeName = "uuid")]
    public Guid? ExternalPayerAttestationId { get; set; }

    [Column("requested_by_user_id", TypeName = "uuid")]
    public Guid RequestedByUserId { get; set; }

    [Column("requested_at", TypeName = "timestamptz")]
    public DateTimeOffset RequestedAt { get; set; }

    [Column("requested_amount", TypeName = "numeric(18,0)")]
    public decimal RequestedAmount { get; set; }

    [Column("reason", TypeName = "text")]
    public string Reason { get; set; } = null!;

    [Column("status", TypeName = "varchar(12)")]
    public string Status { get; set; } = null!;

    [Column("decided_by_user_id", TypeName = "uuid")]
    public Guid? DecidedByUserId { get; set; }

    [Column("decided_at", TypeName = "timestamptz")]
    public DateTimeOffset? DecidedAt { get; set; }

    [Column("decision_reason", TypeName = "text")]
    public string? DecisionReason { get; set; }

    [Column("executed_at", TypeName = "timestamptz")]
    public DateTimeOffset? ExecutedAt { get; set; }

    [Column("external_refund_reference", TypeName = "varchar(200)")]
    public string? ExternalRefundReference { get; set; }

    [Column("execution_evidence_key", TypeName = "varchar(250)")]
    public string? ExecutionEvidenceKey { get; set; }

    [Column("operation_key", TypeName = "uuid")]
    public Guid OperationKey { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
