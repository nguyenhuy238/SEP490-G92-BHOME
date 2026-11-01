using BHome.Domain.Common;

namespace BHome.Domain.Billing;

public sealed class InvoiceAdjustmentRequest : AuditableEntity
{
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;
    public Guid RequesterId { get; set; }
    public Guid? InvoiceLineId { get; set; }
    public string? ChargeCode { get; set; }
    public decimal CurrentAmount { get; set; }
    public decimal? ProposedAmount { get; set; }
    public string Reason { get; set; } = "";
    public string InvoiceSnapshot { get; set; } = "";
    public InvoiceStatus InvoiceStatus { get; set; }
    public int InvoiceVersion { get; set; }
    public int FinancialVersion { get; set; }
    public DateTimeOffset SubmittedAt { get; set; }
    public List<InvoiceAdjustmentEvidence> Evidence { get; set; } = [];
    public InvoiceAdjustmentDecision? Decision { get; set; }
}
public sealed class InvoiceAdjustmentDecision : AuditableEntity
{
    public long Sequence { get; set; }
    public Guid RequestId { get; set; }
    public Guid InvoiceId { get; set; }
    public string Outcome { get; set; } = "";
    public InvoiceStatus InvoiceStatus { get; set; }
    public string? ChargeCode { get; set; }
    public decimal BeforeAmount { get; set; }
    public decimal? CorrectedAmount { get; set; }
    public decimal Delta { get; set; }
    public decimal EffectiveBefore { get; set; }
    public decimal EffectiveAfter { get; set; }
    public decimal PaidAtDecision { get; set; }
    public string SourceFingerprint { get; set; } = "";
    public string Reason { get; set; } = "";
    public Guid OwnerId { get; set; }
    public DateTimeOffset DecidedAt { get; set; }
}
public sealed class InvoiceAdjustmentEvidence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public Guid UploaderId { get; set; }
    public Guid? RequestId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Length { get; set; }
    public bool Uploaded { get; set; }
    public DateTimeOffset CleanupAfter { get; set; }
}
public sealed class InvoiceAdjustmentCommand
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public string Operation { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public Guid RequestId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
public sealed class InvoiceAdjustmentEvent
{
    public Guid RequestId { get; set; }
    public string Name { get; set; } = "";
    public Guid InvoiceId { get; set; }
    public Guid RequesterId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
public static class AdjustmentRules
{
    public const decimal MoneyLimit = 1_000_000_000_000_000_000m;
    public static bool Money(decimal value) => value >= 0 && value < MoneyLimit && decimal.Truncate(value) == value;
    public static string SourceFingerprint(InvoiceLine line)
    {
        static string D(decimal value) => value.ToString("G29", System.Globalization.CultureInfo.InvariantCulture);
        var value = new { line.Category, line.ChargeCode, line.Name, line.PolicyId, line.PolicyVersion, line.RateDate,
            Rate = D(line.Rate), Quantity = D(line.Quantity), line.OccupiedDays, line.PeriodDays,
            Amount = D(line.CalculatedAmount ?? line.Amount), line.MeterReadingId,
            Previous = line.PreviousReading is { } p ? D(p) : null, Confirmed = line.ConfirmedReading is { } c ? D(c) : null };
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(value)));
    }
}
