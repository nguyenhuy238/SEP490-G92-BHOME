using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using BHome.Domain.Common;

namespace BHome.Domain.PaymentsDebt;

public sealed class PaymentAllocation : AuditableEntity
{
    internal static PaymentAllocation RestoreIdentity(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };

    [NotMapped, JsonIgnore] public Guid? SourcePaymentId { get; set; }
    public Guid? TransferId { get => SourcePaymentId; set => SourcePaymentId = value; }
    public Guid? SourceDepositContractId { get; set; }
    [NotMapped, JsonIgnore] public Guid? TargetInvoiceId { get; set; }
    public Guid? InvoiceId { get => TargetInvoiceId; set => TargetInvoiceId = value; }
    public Guid? TargetDepositContractId { get; set; }
    [NotMapped] public Guid? TargetInitialContractId { get; set; }
    [NotMapped] public Guid? TargetSettlementContractId { get; set; }
    [NotMapped] public Guid? SettlementReceivableId { get; set; }
    [NotMapped] public Guid? DepositOffsetApprovalId { get; set; }
    public decimal Amount { get; set; }
    public Guid? PaidByUserId { get; set; }
    public Guid VerifiedByUserId { get => CreatedByUserId ?? Guid.Empty; set => CreatedByUserId = value == Guid.Empty ? null : value; }
    public DateTimeOffset AllocatedAt { get; set; }

    [NotMapped, JsonIgnore] public Guid? ReversalOfAllocationId { get; set; }
    [NotMapped, JsonIgnore] public Guid OperationKey { get; set; }
    [NotMapped, JsonIgnore] public short LineNumber { get; set; }
    [NotMapped, JsonIgnore] public Guid? CreatedByUserId { get; set; }
    [NotMapped, JsonIgnore] public string Reason { get; set; } = "";
}
