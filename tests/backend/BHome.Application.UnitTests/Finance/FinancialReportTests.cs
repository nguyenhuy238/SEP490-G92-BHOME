using BHome.Application.Finance;

namespace BHome.Application.UnitTests.Finance;

public sealed class FinancialReportTests
{
    private static readonly ReportFilter Period=new(new(2026,10,1),new(2026,10,31));
    [Fact]
    public void SeparatesIssuedAdjustedCollectedDebtAndOperatingCostsAndUsesCumulativeCashForCapital()
    {
        var report=FinancialReportService.Calculate(Period,new([new(Guid.NewGuid(),"Test",1000,-100,600,200,300,2000,1600,400,10,6)],false),DateTimeOffset.UtcNow);
        Assert.Equal("700",report.Total.OperatingProfit); Assert.Equal("400",report.Total.NetOperatingCashFlow);
        Assert.Equal("1200",report.Capital.NetRecovery); Assert.Equal("800",report.Capital.RemainingCapital);
        Assert.Equal("60",report.Capital.RecoveryPercent); Assert.Equal("2",report.Capital.EstimatedRemainingMonths);
        Assert.Equal("300",report.Total.OutstandingNow);
    }
    [Theory]
    [InlineData(0,0,0,"initial_investment_required")]
    [InlineData(1000,0,0,"positive_cash_flow_required")]
    [InlineData(1000,100,200,"positive_cash_flow_required")]
    public void DoesNotInventPaybackForMissingCapitalOrNonPositiveCash(decimal investment,decimal collected,decimal costs,string reason)
    {
        var report=FinancialReportService.Calculate(Period,new([new(Guid.NewGuid(),"Test",Collected:collected,Operating:costs,Investment:investment)],false),DateTimeOffset.UtcNow);
        Assert.Null(report.Capital.EstimatedRemainingMonths); Assert.Equal(reason,report.Capital.UnavailableReason);
    }
    [Fact]
    public void RefusesToHideRefundUncertaintyAndHandlesEmptyAndAlreadyRecoveredCapital()
    {
        var row=new FinanceBasis(Guid.NewGuid(),"Test",Collected:100,Investment:1000,CumulativeCollected:2000);
        var report=FinancialReportService.Calculate(Period,new([row],true),DateTimeOffset.UtcNow);
        Assert.Null(report.Total.NetOperatingCashFlow); Assert.Null(report.Capital.NetRecovery);
        Assert.Equal("refund_classification_required",report.Capital.UnavailableReason);
        var recovered=FinancialReportService.Calculate(Period,new([row],false),DateTimeOffset.UtcNow);
        Assert.Equal("0",recovered.Capital.RemainingCapital); Assert.Equal("0",recovered.Capital.EstimatedRemainingMonths);
        Assert.Empty(FinancialReportService.Calculate(Period,new([],false),DateTimeOffset.UtcNow).Locations);
    }
}
