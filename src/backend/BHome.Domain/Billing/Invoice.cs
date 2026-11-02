using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

public enum InvoiceStatus { Draft, Final }
public enum BillingRateDate { PeriodStart, PeriodEnd }
public enum BillingRentSource { RoomPolicy, RepresentativeContract }
public enum PartialMonthRule { FullMonth, OccupiedCalendarDays }
public enum VndRounding { AwayFromZero, ToEven }

// Explicit Owner selections; no implicit financial defaults when configuration is missing.
public sealed class BillingSchedule : AuditableEntity
{
    public Guid LocationId { get; set; }
    public BillingRateDate RateDate { get; set; }
    public BillingRentSource RentSource { get; set; }
    public PartialMonthRule PartialMonth { get; set; }
    public VndRounding Rounding { get; set; }
    public int DraftDay { get; set; }
    public int DraftMonthOffset { get; set; }
    public int FinalDay { get; set; }
    public int FinalMonthOffset { get; set; }
    public int DueDay { get; set; }
    public int DueMonthOffset { get; set; }
    public int Version { get; set; } = 1;
}

public sealed class Invoice : AuditableEntity
{
    public Guid? AutomationPlanId{get;set;}
    public Guid? AutomationFinalizationPlanId{get;set;}
    public Guid RoomId { get; set; }
    public Guid LocationId { get; set; }
    public string RoomNumber { get; set; } = "";
    public string LocationName { get; set; } = "";
    public DateOnly BillingPeriod { get; set; }
    public Guid RepresentativeContractId { get; set; }
    public Guid RepresentativeTenantUserId { get; set; }
    public InvoiceStatus Status { get; set; }
    public int Version { get; set; } = 1;
    public decimal Total { get; set; }
    public string[] MissingInputs { get; set; } = [];
    public string ScheduleSnapshot { get; set; } = "";
    public DateOnly ScheduledFinalDate { get; set; }
    public DateOnly DueDate { get; set; }
    public Guid CreatedByUserId { get; set; }
    public Guid? FinalizedByUserId { get; set; }
    public DateTimeOffset? FinalizedAt { get; set; }
    public List<InvoiceLine> Lines { get; set; } = [];
    public List<InvoiceRecipient> Recipients { get; set; } = [];
}

public sealed class InvoiceLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public ChargeCategory Category { get; set; }
    public string ChargeCode { get; set; } = "";
    public string Name { get; set; } = "";
    public Guid? PolicyId { get; set; }
    public int? PolicyVersion { get; set; }
    public DateOnly RateDate { get; set; }
    public decimal Rate { get; set; }
    public decimal Quantity { get; set; }
    public int OccupiedDays { get; set; }
    public int PeriodDays { get; set; }
    public decimal Amount { get; set; }
    public decimal? CalculatedAmount { get; set; }
    public Guid? CorrectionRequestId { get; set; }
    public Guid? MeterReadingId { get; set; }
    public decimal? PreviousReading { get; set; }
    public decimal? ConfirmedReading { get; set; }
}

// Snapshot entitlements: former occupants retain access, new occupants never inherit old bills.
public sealed class InvoiceRecipient
{
    public Guid InvoiceId { get; set; }
    public Guid TenantUserId { get; set; }
}
// Committed with issuance; consumers never infer issuance from a draft or an uncommitted job.
public sealed class InvoiceIssuedEvent
{
    public Guid InvoiceId{get;set;}
    public Guid OwnerUserId{get;set;}
    public Guid? AutomationPlanId{get;set;}
    public DateTimeOffset OccurredAt{get;set;}
}

public static class InvoiceMath
{
    public static decimal Amount(decimal rate, decimal quantity, int occupiedDays, int periodDays,
        PartialMonthRule partial, VndRounding rounding, bool metered)
    {
        if (rate < 0 || quantity < 0 || periodDays is < 28 or > 31 || occupiedDays < 1 || occupiedDays > periodDays ||
            !Enum.IsDefined(partial) || !Enum.IsDefined(rounding)) throw new ArgumentOutOfRangeException(nameof(rate));
        var raw = checked(rate * quantity);
        if (!metered && partial == PartialMonthRule.OccupiedCalendarDays) raw = checked(raw * occupiedDays / periodDays);
        var amount = decimal.Round(raw, 0, rounding == VndRounding.AwayFromZero ? MidpointRounding.AwayFromZero : MidpointRounding.ToEven);
        if (amount >= 1_000_000_000_000_000_000m) throw new ArgumentOutOfRangeException(nameof(rate));
        return amount;
    }

    public static DateOnly CalendarDate(DateOnly period, int day, int monthOffset)
    {
        if (period.Day != 1 || day is < 1 or > 31 || monthOffset is < 0 or > 2) throw new ArgumentOutOfRangeException(nameof(day));
        var month = period.AddMonths(monthOffset);
        return new(month.Year, month.Month, Math.Min(day, DateTime.DaysInMonth(month.Year, month.Month)));
    }
}
