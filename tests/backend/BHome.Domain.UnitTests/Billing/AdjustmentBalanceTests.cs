using BHome.Domain.Billing;

namespace BHome.Domain.UnitTests.Billing;

public sealed class AdjustmentBalanceTests
{
    [Theory]
    [InlineData(100000, -10000, 0, 90000, 90000, 0)]
    [InlineData(100000, 10000, 0, 110000, 110000, 0)]
    [InlineData(100000, -10000, 100000, 90000, 0, 10000)]
    [InlineData(100000, 10000, 100000, 110000, 10000, 0)]
    [InlineData(100000, 10000, 110000, 110000, 0, 0)]
    public void BalancePreservesVerifiedMoneyAndSeparatesOutstandingFromExcess(decimal original, decimal delta, decimal paid, decimal payable, decimal outstanding, decimal excess)
    { Assert.Equal((payable, outstanding, excess), AdjustmentRules.Balance(original, delta, paid)); }
    [Fact]
    public void CannotMakeNegativeOrFractionalObligation()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AdjustmentRules.Balance(100, -101, 100));
        Assert.Throws<ArgumentOutOfRangeException>(() => AdjustmentRules.Balance(100, .5m, 100));
    }
}
