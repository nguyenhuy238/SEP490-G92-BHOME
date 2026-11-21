using BHome.Application.Finance;

namespace BHome.Application.UnitTests.Finance;

public sealed class FinancialScenarioTests
{
    private static readonly ReportFilter Filter = new(new(2026, 10, 1), new(2026, 10, 31));
    private static FinancialReport Baseline() => FinancialReportService.Calculate(Filter, new([new(Guid.NewGuid(), "Test", Issued: 1000, Collected: 600, Operating: 200, Investment: 10000, Rooms: 2)], false), DateTimeOffset.UtcNow);
    [Fact]
    public void UsesExplicitOccupancyCollectionAndMonthlyCostsAndDoesNotChangeBaseline()
    {
        var baseline = Baseline(); var before = baseline.Total;
        var input = new ScenarioInput("Test", Filter, 12, new(1000, 50, 80, 100, 100, 100, 100));
        var result = FinancialScenarioService.Calculate(input, baseline);
        Assert.Equal("1000", result.MonthlyRevenue); Assert.Equal("800", result.MonthlyCollections);
        Assert.Equal("600", result.MonthlyProfit); Assert.Equal("400", result.MonthlyNetCashFlow);
        Assert.Equal("4800", result.ForecastNetCashFlow); Assert.Equal("5200", result.RemainingCapitalAtEnd);
        Assert.Equal("25", result.EstimatedRemainingMonths); Assert.Equal("-200", result.MonthlyProfitDifference);
        Assert.Equal(before, baseline.Total);
    }
    [Fact]
    public void NegativeProjectionKeepsLossesAndUnavailablePayback()
    {
        var input = new ScenarioInput("Test", Filter, 12, new(100, 0, 0, 100, 0, 0, 0));
        var result = FinancialScenarioService.Calculate(input, Baseline());
        Assert.Equal("-100", result.MonthlyProfit); Assert.Equal("-1200", result.ForecastNetCashFlow);
        Assert.Equal("11200", result.RemainingCapitalAtEnd); Assert.Null(result.EstimatedRemainingMonths);
        Assert.Equal("positive_cash_flow_required", result.UnavailableReason);
    }
}
