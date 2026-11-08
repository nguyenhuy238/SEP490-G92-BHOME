using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class UtilityTariffMathTests
{
    [Theory]
    [InlineData(0, 0)]
    [InlineData(50, 50000)]
    [InlineData(100, 125000)]
    [InlineData(120, 165000)]
    public void ProgressiveTiersChargeOnlyTheUnitsInEachBand(int units, int expected) =>
        Assert.Equal(expected, UtilityTariffMath.Calculate(units, [new(50, 1000), new(100, 1500), new(null, 2000)], VndRounding.AwayFromZero));
    [Theory]
    [InlineData(-1)]
    [InlineData(1000000001)]
    public void InvalidConsumptionIsRejected(decimal quantity) => Assert.Throws<PropertyException>(() =>
        UtilityTariffMath.Calculate(quantity, [new(null, 1000)], VndRounding.AwayFromZero));
    [Fact]
    public void DecreasingBoundsMissingUnboundedTierAndNegativeRatesAreRejected()
    {
        Assert.Throws<PropertyException>(() => UtilityTariffMath.Calculate(20, [new(100, 1), new(50, 1), new(null, 1)], VndRounding.ToEven));
        Assert.Throws<PropertyException>(() => UtilityTariffMath.Calculate(20, [new(100, 1)], VndRounding.ToEven));
        Assert.Throws<PropertyException>(() => UtilityTariffMath.Calculate(20, [new(null, -1)], VndRounding.ToEven));
    }
    [Fact]
    public void OwnerSelectedRoundingIsAppliedOnceToTheTotal()
    {
        Assert.Equal(2, UtilityTariffMath.Calculate(1, [new(null, 2.5m)], VndRounding.ToEven));
        Assert.Equal(3, UtilityTariffMath.Calculate(1, [new(null, 2.5m)], VndRounding.AwayFromZero));
    }
}
