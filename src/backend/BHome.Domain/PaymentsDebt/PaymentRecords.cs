using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using BHome.Domain.Common;

namespace BHome.Domain.PaymentsDebt;

public sealed class PaymentTransfer : AuditableEntity
{
    public string ProviderIdentity { get; set; } = "";
    public string BankReference { get; set; } = "";
    public string NormalizedReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "VND";
    public DateTimeOffset OccurredAt { get; set; }
    public string TransferDescription { get; set; } = "";
    public string StatementReference { get; set; } = "";
    public string VerificationReason { get; set; } = "";
    public string VerificationSource { get; set; } = "OwnerBankStatement";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
    public Guid? ProposedInvoiceId { get; set; }
    public bool IsDevelopmentDemo { get; set; }
}
public sealed class PaymentAllocation : AuditableEntity
{
    public Guid TransferId { get; set; }
    public Guid InvoiceId { get; set; }
    public decimal Amount { get; set; }
    public Guid? PaidByUserId { get; set; }
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset AllocatedAt { get; set; }
}
public sealed class PaymentReconciliation : AuditableEntity
{
    public long Sequence { get; set; }
    public Guid TransferId { get; set; }
    public Guid? InvoiceId { get; set; }
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
}
public static partial class PaymentRules
{
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9 /_.:-]{0,149}$", RegexOptions.CultureInvariant)]
    private static partial Regex BankReferencePattern();
    public static string NormalizeReference(string reference) => reference.Trim().ToUpperInvariant();
    public static bool ValidReference(string reference) => BankReferencePattern().IsMatch(reference);
    public static bool ValidMoney(decimal amount) => amount > 0 && amount < 1_000_000_000_000_000_000m && decimal.Truncate(amount) == amount;
    public static string? ReviewReason(decimal amount, decimal outstanding, string description, string expectedReference, bool referenceClaimed)
    {
        if (referenceClaimed) return "bank_reference_already_credited";
        if (outstanding <= 0) return "invoice_already_settled";
        if (!string.Equals(description.Trim(), expectedReference, StringComparison.OrdinalIgnoreCase)) return "invoice_transfer_reference_mismatch";
        if (amount < outstanding) return "partial_payment_policy_required";
        if (amount > outstanding) return "excess_payment_policy_required";
        return null;
    }
    public static int OverdueDays(DateOnly dueDate, DateOnly today, decimal outstanding) => outstanding > 0 && dueDate < today ? today.DayNumber - dueDate.DayNumber : 0;
    public static DateTimeOffset Timestamp(DateTimeOffset value) { var utc = value.ToUniversalTime(); return utc.AddTicks(-(utc.Ticks % 10)); }
    // Injective 128-bit ID encoding in 25 alphanumeric characters, fitting VietQR addInfo.
    public static string InvoiceReference(Guid id)
    {
        var number = BigInteger.Parse("0" + id.ToString("N"), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        const string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var text = "";
        do { number = BigInteger.DivRem(number, 36, out var remainder); text = alphabet[(int)remainder] + text; } while (number > 0);
        return text.PadLeft(25, '0');
    }
}
