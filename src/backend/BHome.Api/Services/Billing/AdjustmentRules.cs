namespace BHome.Domain.Billing;

public static class AdjustmentRules
{
    public const decimal MoneyLimit = 1_000_000_000_000_000_000m;
    public static bool Money(decimal value) => value >= 0 && value < MoneyLimit && decimal.Truncate(value) == value;
    public static (decimal Payable, decimal Outstanding, decimal Excess) Balance(decimal issued, decimal adjustments, decimal paid)
    {
        var payable = issued + adjustments;
        if (!Money(issued) || !Money(payable) || paid < 0 || decimal.Truncate(paid) != paid) throw new ArgumentOutOfRangeException(nameof(issued));
        return (decimal.Truncate(payable), decimal.Truncate(Math.Max(0, payable - paid)), decimal.Truncate(Math.Max(0, paid - payable)));
    }
    public static string SourceFingerprint(InvoiceItem line)
    {
        static string D(decimal value) => value.ToString("G29", System.Globalization.CultureInfo.InvariantCulture);
        var value = new
        {
            line.Category,
            line.ChargeCode,
            line.Name,
            line.PolicyId,
            line.PolicyVersion,
            line.RateDate,
            Rate = D(line.Rate),
            Quantity = D(line.Quantity),
            line.OccupiedDays,
            line.PeriodDays,
            Amount = D(line.CalculatedAmount ?? line.Amount),
            line.MeterReadingId,
            Previous = line.PreviousReading is { } p ? D(p) : null,
            Confirmed = line.ConfirmedReading is { } c ? D(c) : null
        };
        var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(value);
        if (!string.IsNullOrEmpty(line.UtilityCalculationSnapshot))
            bytes = bytes.Concat(System.Text.Encoding.UTF8.GetBytes("\n" + line.UtilityCalculationSnapshot)).ToArray();
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
    }
}
