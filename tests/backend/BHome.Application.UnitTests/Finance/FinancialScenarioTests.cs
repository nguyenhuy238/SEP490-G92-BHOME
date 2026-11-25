using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Finance;

public sealed class FinancialScenarioTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Theory]
    [InlineData("2026-11-25T05:00:00Z", false)]
    [InlineData("2026-11-30T16:59:59Z", false)]
    [InlineData("2026-11-30T17:00:00Z", true)]
    public async Task AnalyzeRequiresACompletedBaselineUsingVietnamBusinessDate(string snapshot, bool completed)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Roles.Owner).Returns(true);
        var repository = Substitute.For<IFinancialReportRepository>();
        repository.ReadAsync(Arg.Any<ReportFilter>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new ReportBasis([new(Guid.NewGuid(), "Synthetic", Rooms: 1)], false)));
        var reports = new FinancialReportService(repository, user, new FixedClock(DateTimeOffset.Parse(snapshot)));
        var scenarios = new FinancialScenarioService(Substitute.For<IFinancialScenarioRepository>(), reports, user);
        var input = new ScenarioInput("Synthetic", new(new(2026, 11, 1), new(2026, 11, 30)), 1,
            new(1000, 100, 100, 0, 0, 0, 0));
        if (completed)
            Assert.Equal("1000", (await scenarios.AnalyzeAsync(input, default)).Result.MonthlyRevenue);
        else
        {
            var error = await Assert.ThrowsAsync<FinanceException>(() => scenarios.AnalyzeAsync(input, default));
            Assert.Equal(400, error.Status);
            Assert.Equal("completed_baseline_required", error.Code);
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void UnknownHistoricalCashDoesNotProduceAProjectedRemainingCapital(bool unclassifiedRefunds)
    {
        var baseline = Baseline();
        var recovery = new CapitalRecovery("10000", null, "10000", null, null,
            unclassifiedRefunds ? "refund_classification_required" : "expense_payment_history_required");
        baseline = baseline with { HasUnclassifiedRefunds = unclassifiedRefunds, Capital = recovery };
        var result = FinancialScenarioService.Calculate(new("Synthetic", Filter, 2,
            new(1000, 50, 80, 100, 100, 100, 100)), baseline);
        Assert.Null(result.RemainingCapitalAtEnd);
        Assert.Null(result.EstimatedRemainingMonths);
        Assert.Equal(recovery.UnavailableReason, result.UnavailableReason);
        Assert.Equal("800", result.ForecastNetCashFlow);
    }

    [Fact]
    public void ExplicitAdditionalInvestmentCanProjectPaybackWhenHistoricalCapitalIsVerifiedZero()
    {
        var basis = new FinanceManagementBasis(0, 0, 0, 0, 0, 0, 0, 0,
            OperatingPaymentsConfirmed: 0, OperatingPaymentHistoryComplete: true,
            CumulativeBusinessCollections: 0, CumulativeOperatingPayments: 0);
        var baseline = FinancialReportService.Calculate(Filter,
            new([new(Guid.NewGuid(), "Synthetic", Rooms: 2, Management: basis)], false),
            new DateTimeOffset(2026, 11, 25, 0, 0, 0, TimeSpan.Zero));
        Assert.Equal("initial_investment_required", baseline.Total.Management!.CashCapital!.UnavailableReason);
        var input = new ScenarioInput("Synthetic new investment", Filter, 1,
            new(1000, 50, 80, 100, 100, 100, 100, AdditionalInvestment: 500));
        var result = FinancialScenarioService.Calculate(input, baseline);
        Assert.Equal("400", result.MonthlyNetCashFlow);
        Assert.Equal("100", result.RemainingCapitalAtEnd);
        Assert.Equal("1.25", result.EstimatedRemainingMonths);
        Assert.Equal("-100", result.ForecastCashAfterInvestment);
        Assert.Null(result.UnavailableReason);
    }

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
        Assert.Contains("cash_shortfall_risk", result.Warnings!);
        Assert.Contains("lower_operating_profit", result.Warnings!);
        Assert.Contains("missing_depreciation", result.Warnings!);
    }
    [Fact]
    public void SeparatesProjectedPaymentDepreciationAndAdditionalInvestment()
    {
        var baseline = Baseline();
        var result = FinancialScenarioService.Calculate(new("Test", Filter, 2,
            new(1000, 50, 80, 100, 100, 100, 100, MonthlyServiceRevenue: 200,
                AdditionalInvestment: 500, MonthlyDepreciation: 100, OperatingPaymentPercent: 50,
                CostIncreasePercent: 25)), baseline);
        Assert.Equal("1200", result.MonthlyRevenue);
        Assert.Equal("960", result.MonthlyCollections);
        Assert.Equal("500", result.MonthlyOperatingExpenses);
        Assert.Equal("250", result.MonthlyOperatingPayments);
        Assert.Equal("700", result.MonthlyProfit);
        Assert.Equal("600", result.MonthlyProfitAfterDepreciation);
        Assert.Equal("710", result.MonthlyNetCashFlow);
        Assert.Equal("920", result.ForecastCashAfterInvestment);
        Assert.Equal("9080", result.RemainingCapitalAtEnd);
        Assert.Contains("higher_operating_cost", result.Warnings!);
        Assert.Contains("lower_operating_profit", result.Warnings!);
        Assert.DoesNotContain("missing_depreciation", result.Warnings!);
        Assert.Equal("1000", baseline.Total.Issued);
    }
}
