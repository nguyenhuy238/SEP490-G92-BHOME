using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

public sealed class InvoiceItem
{
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string? UtilityCalculationSnapshot { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public ChargeCategory Category { get; set; }
    public string ChargeCode { get; set; } = "";
    [NotMapped, JsonIgnore] public string Description { get; set; } = "";
    public string Name { get => Description; set => Description = value; }
    [NotMapped, JsonIgnore] public Guid? BillingPolicyId { get; set; }
    public Guid? PolicyId { get => BillingPolicyId; set => BillingPolicyId = value; }
    public int? PolicyVersion { get; set; }
    public DateOnly RateDate { get; set; }
    [NotMapped, JsonIgnore] public decimal UnitPrice { get; set; }
    public decimal Rate { get => UnitPrice; set => UnitPrice = value; }
    public decimal Quantity { get; set; }
    public int OccupiedDays { get; set; }
    public int PeriodDays { get; set; }
    public decimal Amount { get; set; }
    public decimal? CalculatedAmount { get; set; }
    public Guid? CorrectionRequestId { get; set; }
    public Guid? MeterReadingId { get; set; }
    public decimal? PreviousReading { get; set; }
    public decimal? ConfirmedReading { get; set; }

    private JsonElement calculationSnapshot;
    [NotMapped, JsonIgnore]
    public JsonElement CalculationSnapshot
    {
        get => calculationSnapshot;
        set
        {
            calculationSnapshot = value;
            var state = InvoiceSnapshot.Read<LineMetadata>(value);
            Category = state?.Category ?? default;
            PolicyVersion = state?.PolicyVersion;
            RateDate = state?.RateDate ?? default;
            OccupiedDays = state?.OccupiedDays ?? 0;
            PeriodDays = state?.PeriodDays ?? 0;
            CalculatedAmount = state?.CalculatedAmount;
            CorrectionRequestId = state?.CorrectionRequestId;
            PreviousReading = state?.PreviousReading;
            ConfirmedReading = state?.ConfirmedReading;
            UtilityCalculationSnapshot = state?.UtilityCalculationSnapshot;
        }
    }

    private sealed record LineMetadata(ChargeCategory Category, int? PolicyVersion,
        DateOnly RateDate, int OccupiedDays, int PeriodDays, decimal? CalculatedAmount,
        Guid? CorrectionRequestId, decimal? PreviousReading, decimal? ConfirmedReading,
        string? UtilityCalculationSnapshot);
}
