using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.UnitTests.Contracts;

public sealed class FixedChargeCalculationTests
{
    private static readonly DateOnly Period = new(2026, 11, 1);
    private static readonly PolicyDto Rent = new(Guid.NewGuid(), Guid.NewGuid(), null, ChargeCategory.Rent, "RENT", "Synthetic rent",
        ChargingMethod.FixedPerRoomPerMonth, 3000000, Period, null, 1);
    [Theory]
    [InlineData(PartialMonthRule.FullMonth, 3000000)]
    [InlineData(PartialMonthRule.OccupiedCalendarDays, 1500000)]
    public void PartialMonthUsesTheExplicitPolicy(PartialMonthRule partial, decimal expected)
    {
        var result = FixedChargeCalculation.Calculate(Period, Rent, new() { PartialMonth = partial }, "synthetic-signed-hash", 15, []);
        Assert.Empty(result.MissingInputs); Assert.Equal(expected, result.Amount);
    }
    [Fact]
    public void EarlierDepartureRequiresASufficientOwnerApprovedReductionAndDoesNotRecollectIt()
    {
        var schedule = new BillingSchedule { PartialMonth = PartialMonthRule.OccupiedCalendarDays };
        var original = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 30, []);
        var adjustment = Guid.NewGuid();
        var pending = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, [new(Guid.NewGuid(), original.Source)]);
        Assert.Null(pending.Amount);
        var insufficient = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, [new(Guid.NewGuid(), original.Source, 1000000, [adjustment])]);
        Assert.Null(insufficient.Amount);
        var approved = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, [new(Guid.NewGuid(), original.Source, 1500000, [adjustment])]);
        Assert.Empty(approved.MissingInputs); Assert.Equal(0, approved.Amount);
        Assert.Equal(1500000, approved.Source.PolicyCalculatedAmount); Assert.Equal(3000000, approved.Source.CumulativePricedAmount);
        Assert.Equal(adjustment, Assert.Single(approved.Source.ApprovedAdjustmentIds!));
        var later = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 30, [new(Guid.NewGuid(), approved.Source)]);
        Assert.Empty(later.MissingInputs); Assert.Equal(0, later.Amount);
    }
    [Fact]
    public void FullMonthAlreadyPricedRemainsCoveredWhenTheActualDepartureIsEarlier()
    {
        var schedule = new BillingSchedule { PartialMonth = PartialMonthRule.FullMonth };
        var original = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 30, []);
        var departure = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, [new(Guid.NewGuid(), original.Source)]);
        Assert.Empty(departure.MissingInputs); Assert.Equal(0, departure.Amount);
    }
    [Fact]
    public void FurtherOccupancyChargesOnlyTheIncrementWithoutRecollectingAnApprovedDiscount()
    {
        var schedule = new BillingSchedule { PartialMonth = PartialMonthRule.OccupiedCalendarDays };
        var first = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, []);
        // Coverage stores the original policy price, not the discounted payable.
        var next = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 30, [new(Guid.NewGuid(), first.Source)]);
        Assert.Equal(1500000, next.Amount);
        var same = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 15, [new(Guid.NewGuid(), first.Source)]);
        Assert.Equal(0, same.Amount);
        var changed = FixedChargeCalculation.Calculate(Period, Rent with { Rate = 3500000 }, schedule, "hash", 30, [new(Guid.NewGuid(), first.Source)]);
        Assert.Null(changed.Amount); Assert.Contains("fixed_charge_policy_changed", changed.MissingInputs);
        var backwards = FixedChargeCalculation.Calculate(Period, Rent, schedule, "hash", 10, [new(Guid.NewGuid(), first.Source)]);
        Assert.Null(backwards.Amount);
    }
}
