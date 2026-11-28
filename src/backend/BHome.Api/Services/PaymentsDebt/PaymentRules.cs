using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PaymentsDebt;

public static partial class PaymentRules
{
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9 /_.:-]{0,149}$", RegexOptions.CultureInvariant)]
    private static partial Regex BankReferencePattern();
    public static string NormalizeReference(string reference) => reference.Trim().ToUpperInvariant();
    public static bool ValidReference(string reference) => BankReferencePattern().IsMatch(reference);
    public static bool ValidMoney(decimal amount) => amount > 0 && amount < 1_000_000_000_000_000_000m && decimal.Truncate(amount) == amount;
    public static string? ReviewReason(decimal amount, decimal outstanding, string description, string expectedReference, bool referenceClaimed, bool amountMismatchSupported = false)
    {
        if (referenceClaimed) return "bank_reference_already_credited";
        if (outstanding <= 0) return "invoice_already_settled";
        if (!string.Equals(description.Trim(), expectedReference, StringComparison.OrdinalIgnoreCase)) return "invoice_transfer_reference_mismatch";
        if (!ValidMoney(amount)) return "invalid_payment_amount";
        if (!amountMismatchSupported && amount < outstanding) return "partial_payment_policy_required";
        if (!amountMismatchSupported && amount > outstanding) return "excess_payment_policy_required";
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
    public static string DepositReference(Guid id) => "H" + InvoiceReference(id)[1..];
}
