using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using System.Text.Json;

namespace BHome.Application.UnitTests.Finance;

public sealed class FinancialReportTests
{
    [Fact]
    public void SettlementBreakdownDoesNotAddTheSameMoneyToTotalsTwiceOrTreatOffsetsAsCash()
    {
        var row = new FinanceBasis(Guid.NewGuid(), "Synthetic", Issued: 800000, Collected: 450000, Operating: 50000, Debt: 200000,
            SettlementCharges: 600000, SettlementDebt: 200000, SettlementCollections: 250000, DepositOffsets: 350000, HoldingForfeitures: 100000);
        var report = FinancialReportService.Calculate(new(new(2026, 11, 1), new(2026, 11, 30)), new([row], false), DateTimeOffset.UtcNow);
        Assert.Equal("800000", report.Total.Issued); Assert.Equal("450000", report.Total.VerifiedCollections);
        Assert.Equal("750000", report.Total.OperatingProfit); Assert.Equal("400000", report.Total.NetOperatingCashFlow);
        Assert.Equal("350000", report.SettlementSources!.DepositOffsetsApplied); Assert.Equal("100000", report.SettlementSources.HoldingForfeitures);
        Assert.Equal(report.SettlementSources, Assert.Single(report.Locations).SettlementSources);
    }
    private static readonly ReportFilter Period = new(new(2026, 10, 1), new(2026, 10, 31));
    [Fact]
    public void ReportsDepositPrincipalSeparatelyWithoutChangingInvoiceProfitCashOrRecovery()
    {
        var row = new FinanceBasis(Guid.NewGuid(), "Test", Issued: 1000, Collected: 600, Operating: 200,
            Investment: 2000, CumulativeCollected: 1600, CumulativeOperating: 400);
        var original = FinancialReportService.Calculate(Period, new([row], false), DateTimeOffset.UtcNow);
        var returned = FinancialReportService.Calculate(Period, new([row], false, VerifiedDepositReturns: 9007199254740993), DateTimeOffset.UtcNow);
        Assert.Equal("9007199254740993", returned.VerifiedDepositReturns);
        Assert.Equal(original.Total, returned.Total); Assert.Equal(original.Capital, returned.Capital);
        Assert.Null(original.VerifiedDepositReturns);
        var old = JsonSerializer.Serialize(original).Replace(",\"VerifiedDepositReturns\":null", "", StringComparison.Ordinal);
        Assert.Null(JsonSerializer.Deserialize<FinancialReport>(old)!.VerifiedDepositReturns);
    }

    [Fact]
    public void PreservesHistoricalEvidenceWithoutUsingCurrentRoomCountsOrChangingMoney()
    {
        var row = new FinanceBasis(Guid.NewGuid(), "Test", Collected: 600, Operating: 200, Rooms: 10, Occupied: 9);
        var history = new HistoricalOccupancy("Complete", Period.From, Period.To, 7, 28, 25m, []);
        var report = FinancialReportService.Calculate(Period, new([row], false, history), DateTimeOffset.UtcNow);
        Assert.Equal(history, report.HistoricalOccupancy);
        Assert.Equal(9, report.Total.OccupiedRooms);
        Assert.Equal("400", report.Total.NetOperatingCashFlow);
        var missing = FinancialReportService.Calculate(Period, new([row], false), DateTimeOffset.UtcNow);
        Assert.Null(missing.HistoricalOccupancy);
        Assert.Equal(report.Total, missing.Total);
        Assert.Equal(report.Capital, missing.Capital);
        // Existing saved What-if baselines predate this optional field and remain readable.
        var oldJson = JsonSerializer.Serialize(missing);
        oldJson = oldJson.Replace(",\"HistoricalOccupancy\":null", "", StringComparison.Ordinal);
        Assert.Null(JsonSerializer.Deserialize<FinancialReport>(oldJson)!.HistoricalOccupancy);
    }
    [Fact]
    public void SeparatesIssuedAdjustedCollectedDebtAndOperatingCostsAndUsesCumulativeCashForCapital()
    {
        var report = FinancialReportService.Calculate(Period, new([new(Guid.NewGuid(), "Test", 1000, -100, 600, 200, 300, 2000, 1600, 400, 10, 6)], false), DateTimeOffset.UtcNow);
        Assert.Equal("700", report.Total.OperatingProfit); Assert.Equal("400", report.Total.NetOperatingCashFlow);
        Assert.Equal("1200", report.Capital.NetRecovery); Assert.Equal("800", report.Capital.RemainingCapital);
        Assert.Equal("60", report.Capital.RecoveryPercent); Assert.Equal("2", report.Capital.EstimatedRemainingMonths);
        Assert.Equal("300", report.Total.OutstandingNow);
    }
    [Theory]
    [InlineData(0, 0, 0, "initial_investment_required")]
    [InlineData(1000, 0, 0, "positive_cash_flow_required")]
    [InlineData(1000, 100, 200, "positive_cash_flow_required")]
    public void DoesNotInventPaybackForMissingCapitalOrNonPositiveCash(decimal investment, decimal collected, decimal costs, string reason)
    {
        var report = FinancialReportService.Calculate(Period, new([new(Guid.NewGuid(), "Test", Collected: collected, Operating: costs, Investment: investment)], false), DateTimeOffset.UtcNow);
        Assert.Null(report.Capital.EstimatedRemainingMonths); Assert.Equal(reason, report.Capital.UnavailableReason);
    }
    [Fact]
    public void RefusesToHideRefundUncertaintyAndHandlesEmptyAndAlreadyRecoveredCapital()
    {
        var row = new FinanceBasis(Guid.NewGuid(), "Test", Collected: 100, Investment: 1000, CumulativeCollected: 2000);
        var report = FinancialReportService.Calculate(Period, new([row], true), DateTimeOffset.UtcNow);
        Assert.Null(report.Total.NetOperatingCashFlow); Assert.Null(report.Capital.NetRecovery);
        Assert.Equal("refund_classification_required", report.Capital.UnavailableReason);
        var recovered = FinancialReportService.Calculate(Period, new([row], false), DateTimeOffset.UtcNow);
        Assert.Equal("0", recovered.Capital.RemainingCapital); Assert.Equal("0", recovered.Capital.EstimatedRemainingMonths);
        Assert.Empty(FinancialReportService.Calculate(Period, new([], false), DateTimeOffset.UtcNow).Locations);
    }
}
