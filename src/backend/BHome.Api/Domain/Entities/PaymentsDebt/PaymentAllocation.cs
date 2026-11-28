using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BHome.Domain.Entities;

[Table("payment_allocations", Schema = "public")]
public sealed class PaymentAllocation
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("source_payment_id", TypeName = "uuid")]
    public Guid? SourcePaymentId { get; set; }

    [Column("source_deposit_contract_id", TypeName = "uuid")]
    public Guid? SourceDepositContractId { get; set; }

    [Column("target_invoice_id", TypeName = "uuid")]
    public Guid? TargetInvoiceId { get; set; }

    [Column("target_deposit_contract_id", TypeName = "uuid")]
    public Guid? TargetDepositContractId { get; set; }

    [Column("target_initial_contract_id", TypeName = "uuid")]
    public Guid? TargetInitialContractId { get; set; }

    [Column("target_settlement_contract_id", TypeName = "uuid")]
    public Guid? TargetSettlementContractId { get; set; }

    [Column("settlement_receivable_id", TypeName = "uuid")]
    public Guid? SettlementReceivableId { get; set; }

    [Column("deposit_offset_approval_id", TypeName = "uuid")]
    public Guid? DepositOffsetApprovalId { get; set; }

    [Column("amount", TypeName = "numeric(18,0)")]
    public decimal Amount { get; set; }

    [Column("reversal_of_allocation_id", TypeName = "uuid")]
    public Guid? ReversalOfAllocationId { get; set; }

    [Column("operation_key", TypeName = "uuid")]
    public Guid OperationKey { get; set; }

    [Column("line_number", TypeName = "smallint")]
    public short LineNumber { get; set; }

    [Column("paid_by_user_id", TypeName = "uuid")]
    public Guid? PaidByUserId { get; set; }

    [Column("created_by_user_id", TypeName = "uuid")]
    public Guid? CreatedByUserId { get; set; }

    [Column("allocated_at", TypeName = "timestamptz")]
    public DateTimeOffset AllocatedAt { get; set; }

    [Column("reason", TypeName = "text")]
    public string Reason { get; set; } = null!;
}
