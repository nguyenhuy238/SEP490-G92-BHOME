using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PaymentsDebt;

public sealed class PaymentReconciliation : AuditableEntity
{
    internal static PaymentReconciliation RestoreIdentity(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public long Sequence { get; set; }
    public Guid TransferId { get; set; }
    public Guid? InvoiceId { get; set; }
    public Guid? DepositContractId { get; set; }
    public string Decision { get; set; } = "PendingReview";
    public string Reason { get; set; } = "";
    public Guid ActorId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
// This registry spans the pre-existing Contract deposit ledger and invoice allocations.
public sealed class BankReferenceClaim
{
    public string NormalizedReference { get; set; } = "";
    public Guid? AllocationId { get; set; }
    public Guid? DepositVerificationId { get; set; }
}
public sealed class PaymentCommand
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public string Operation { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public Guid ResultId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
// Durable business event. Notification module consumes this contract after integration approval.
public sealed class PaymentConfirmedEvent
{
    public Guid AllocationId { get; set; }
    public Guid InvoiceId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public string Name { get; set; } = "payment.confirmed.v1";
    public decimal? PaidAmount { get; set; }
    public decimal? OutstandingAmount { get; set; }
}
