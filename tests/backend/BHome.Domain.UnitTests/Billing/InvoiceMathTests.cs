using BHome.Domain.Billing;

namespace BHome.Domain.UnitTests.Billing;

public sealed class InvoiceMathTests
{
    [Theory]
    [InlineData(PartialMonthRule.FullMonth, false, 3000000)]
    [InlineData(PartialMonthRule.OccupiedCalendarDays, false, 1500000)]
    [InlineData(PartialMonthRule.OccupiedCalendarDays, true, 3000000)]
    public void PartialMonthOnlyProratesFixedCharges(PartialMonthRule rule, bool metered, decimal expected) =>
        Assert.Equal(expected, InvoiceMath.Amount(3000000m, 1, 15, 30, rule, VndRounding.AwayFromZero, metered));
    [Theory]
    [InlineData(VndRounding.ToEven, 12)]
    [InlineData(VndRounding.AwayFromZero, 13)]
    public void RoundingIsExplicitPerLine(VndRounding rule, decimal expected) =>
        Assert.Equal(expected, InvoiceMath.Amount(5m, 2.5m, 30, 30, PartialMonthRule.FullMonth, rule, true));
    [Fact]
    public void InvalidInputsAndOverflowCannotCreateAmounts()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => InvoiceMath.Amount(-1, 10, 30, 30, PartialMonthRule.FullMonth, VndRounding.ToEven, true));
        Assert.Throws<ArgumentOutOfRangeException>(() => InvoiceMath.Amount(1, 10, 31, 30, PartialMonthRule.FullMonth, VndRounding.ToEven, true));
        Assert.Throws<OverflowException>(() => InvoiceMath.Amount(decimal.MaxValue, 10, 30, 30, PartialMonthRule.FullMonth, VndRounding.ToEven, true));
    }
    [Fact]
    public void CalendarHandlesMonthEndLeapYearsAndYearBoundary()
    {
        Assert.Equal(new DateOnly(2028, 2, 29), InvoiceMath.CalendarDate(new(2028, 1, 1), 31, 1));
        Assert.Equal(new DateOnly(2027, 2, 28), InvoiceMath.CalendarDate(new(2027, 1, 1), 31, 1));
        Assert.Equal(new DateOnly(2027, 1, 5), InvoiceMath.CalendarDate(new(2026, 12, 1), 5, 1));
    }
}
