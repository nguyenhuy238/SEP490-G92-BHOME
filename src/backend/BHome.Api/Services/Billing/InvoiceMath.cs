namespace BHome.Domain.Billing;

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
