using BHome.Application.Finance;

namespace BHome.Application.UnitTests.Finance;

public sealed class ManagementFinanceTests
{
    [Fact]
    public void MissingAssetPurchasePricesBlockCapitalProjectionWithoutHidingKnownOperatingCash()
    {
        var data = new FinanceManagementBasis(600, 0, 0, 0, 0, 0, 0, 600,
            OperatingPaymentsConfirmed: 200, OperatingPaymentHistoryComplete: true,
            CumulativeBusinessCollections: 1600, CumulativeOperatingPayments: 400,
            InvestmentBasisComplete: false);
        var row = new FinanceBasis(Guid.NewGuid(), "Synthetic", Investment: 2000, Management: data);
        var filter = new ReportFilter(new(2026, 10, 1), new(2026, 10, 31));
        var result = FinanceManagementMath.Calculate(row, false, filter, new(2026, 11, 25))!;
        Assert.Equal("400", result.OperatingCashFlow);
        Assert.Equal("1200", result.CumulativeOperatingCashFlow);
        Assert.Equal("1200", result.CashCapital!.NetRecovery);
        Assert.Equal("investment_basis_required", result.CashCapital.UnavailableReason);
        Assert.Null(result.CashCapital.RemainingCapital);
        Assert.Null(result.CashCapital.RecoveryPercent);
        Assert.Null(result.CashCapital.EstimatedRemainingMonths);
        Assert.Null(result.NetCashAfterInvestment);
        var combined = FinanceManagementMath.Combine([row, row with
        {
            LocationId = Guid.NewGuid(), Management = data with { InvestmentBasisComplete = true }
        }]);
        Assert.False(combined!.InvestmentBasisComplete);
    }

    [Fact]
    public void PartialQuantitySalesFreezeSoldUnitsAndKeepPriorMonths()
    {
        var start = new DateOnly(2026, 1, 1);
        var plan = new DepreciationInput("Equipment", start, 12, 0, null, null, 1, "Test");
        var actor = Guid.NewGuid();
        var lot = new DepreciationLot(Guid.NewGuid(), Guid.NewGuid(), null, null, "Four units", 1200, 4, start, 1,
            [new(Guid.NewGuid(), actor, DateTimeOffset.UnixEpoch, plan, start)]);
        var first = new InvestmentDisposal(Guid.NewGuid(), actor, DateTimeOffset.UnixEpoch, new(new(2026, 3, 15), 100, 1, "First", 1));
        var second = new InvestmentDisposal(Guid.NewGuid(), actor, DateTimeOffset.UnixEpoch, new(new(2026, 4, 15), 200, 2, "Second", 2));
        var sold = lot with { PartialDisposals = [first, second] };
        Assert.Equal(1, sold.RemainingQuantity);
        Assert.Equal(DepreciationMath.Calculate(lot, start, new(2026, 2, 28)),
            DepreciationMath.Calculate(sold, start, new(2026, 2, 28)));
        Assert.Equal(new DepreciationAmounts(75, 275, 675, 75),
            DepreciationMath.Calculate(sold, new(2026, 3, 1), new(2026, 3, 31)));
        Assert.Equal(new DepreciationAmounts(25, 300, 200, 25),
            DepreciationMath.Calculate(sold, new(2026, 4, 1), new(2026, 4, 30)));
        var final = sold with { Disposal = new(Guid.NewGuid(), actor, DateTimeOffset.UnixEpoch, new(new(2026, 5, 10), 50, 3, "Final")) };
        Assert.Equal(0, final.RemainingQuantity);
        Assert.Equal(new DepreciationAmounts(0, 300, 0, 0),
            DepreciationMath.Calculate(final, new(2026, 5, 1), new(2026, 5, 31)));
        Assert.Equal(1200, final.Cost);
        var late = lot with { PartialDisposals = [first with { RecognizedOn = new(2026, 4, 1) }] };
        Assert.Equal(4, DepreciationMath.QuantityAt(late, new(2026, 3, 31)));
        Assert.Equal(3, DepreciationMath.QuantityAt(late, new(2026, 4, 1)));
        Assert.Equal(DepreciationMath.Calculate(lot, start, new(2026, 3, 31)),
            DepreciationMath.Calculate(late, start, new(2026, 3, 31)));
        Assert.Equal(75, DepreciationMath.Calculate(late, new(2026, 4, 1), new(2026, 4, 30))!.Period);
    }
    [Fact]
    public void ReplacementReviewUsesAcceptedCostAndNeverRequiresReplacement()
    {
        var start = new DateOnly(2026, 1, 12);
        var today = new DateOnly(2026, 4, 11);
        var lot = new DepreciationLot(Guid.NewGuid(), Guid.NewGuid(), null, Guid.NewGuid(),
            "Group", 1000, 2, start, 1, []);
        var evidence = new AssetRepairEvidence(3, 500, DateTimeOffset.UnixEpoch);
        var review = DepreciationService.Review(lot, evidence, today, 1000);
        Assert.Equal(2, review.AgeMonths);
        Assert.Equal("500", review.RepairCost);
        Assert.Equal("50", review.RepairCostPercent);
        Assert.Null(review.CarryingValue);
        Assert.Contains("repeated_repairs", review.Reasons);
        Assert.DoesNotContain("repair_cost_half_replacement", review.Reasons);
        Assert.Contains("depreciation_unknown", review.Reasons);
        var aboveHalf = DepreciationService.Review(lot, evidence with { Count = 1, TotalCost = 750 }, today, 1000);
        Assert.Equal("75", aboveHalf.RepairCostPercent);
        Assert.DoesNotContain("repair_cost_half_replacement", aboveHalf.Reasons);
        Assert.DoesNotContain("repeated_repairs", aboveHalf.Reasons);
        Assert.Contains("repeated_repairs", DepreciationService.Review(lot,
            evidence with { Count = 2 }, today, 1000).Reasons);
        Assert.DoesNotContain("repeated_repairs", DepreciationService.Review(lot,
            evidence with { Count = 1 }, today, 1000).Reasons);
        var unknown = DepreciationService.Review(lot, new(0, 0, null), today, null);
        Assert.Null(unknown.ReplacementCost);
        Assert.Null(unknown.RepairCostPercent);
        Assert.DoesNotContain("repeated_repairs", unknown.Reasons);
        Assert.DoesNotContain("repair_cost_half_replacement", unknown.Reasons);
    }
    [Fact]
    public void SeparatesAccrualCashAndUnknownHistory()
    {
        var source = new FinanceManagementBasis(96_000_000, 4_000_000, 0, 0, 10_000_000, 0, 0, 96_000_000,
            OperatingPaymentsConfirmed: 28_000_000, OperatingUnpaidConfirmed: 2_000_000,
            OperatingPaymentHistoryComplete: true, Depreciation: 15_000_000, InvestmentPaymentsConfirmed: 20_000_000,
            InvestmentPaymentHistoryComplete: true);
        var row = new FinanceBasis(Guid.NewGuid(), "Fixture", Issued: 100_000_000, Operating: 30_000_000, Debt: 4_000_000, Management: source);
        var totals = FinanceManagementMath.Calculate(row, false)!;
        Assert.Equal("55000000", totals.ProfitAfterDepreciation);
        Assert.Equal("68000000", totals.OperatingCashFlow);
        Assert.Equal("48000000", totals.NetCashAfterInvestment);
        Assert.Equal("70", totals.OperatingMarginPercent);
        Assert.Equal("96", totals.CollectionRatePercent);
        Assert.Null(FinanceManagementMath.Calculate(row, true)!.OperatingCashFlow);
        Assert.Null(FinanceManagementMath.Calculate(row with { Management = source with { OperatingPaymentHistoryComplete = false } }, false)!.OperatingCashFlow);
    }

    [Fact]
    public void PartialMonthComparisonMatchesElapsedDatesAndZeroPriorHasNoPercent()
    {
        var filter = new ReportFilter(new(2026, 11, 1), new(2026, 11, 25), IncludeComparison: true);
        var dates = FinanceComparisonMath.Periods(filter, filter.To)!.Value;
        Assert.Equal(new DateOnly(2026, 10, 1), dates.Previous.From);
        Assert.Equal(new DateOnly(2026, 10, 25), dates.Previous.To);
        var result = FinanceComparisonMath.Calculate(dates.Current, dates.Previous,
            [new(Guid.NewGuid(), "Test", Issued: 100, Operating: 30)], []);
        Assert.Equal("100", result.Revenue.Change);
        Assert.Null(result.Revenue.ChangePercent);
    }

    [Fact]
    public void StraightLineRoundsCumulativelyNeverExceedsBasisAndStopsAtRetirement()
    {
        var start = new DateOnly(2026, 1, 12);
        var plan = new DepreciationInput("Equipment", start, 3, 100, null, null, 1, "Test");
        var lot = new DepreciationLot(Guid.NewGuid(), Guid.NewGuid(), null, null, "Test", 1100, 2, start, 1, []);
        var effective = DepreciationMath.Validate(lot, plan, start);
        Assert.Equal(new DateOnly(2026, 2, 1), effective);
        Assert.Null(DepreciationMath.Calculate(lot, start, start.AddMonths(1)));
        lot = lot with { Revisions = [new(Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow, plan, effective)] };
        Assert.Equal(0, DepreciationMath.Calculate(lot, start, new(2026, 1, 31))!.Period);
        Assert.Equal(333, DepreciationMath.Calculate(lot, new(2026, 2, 1), new(2026, 2, 28))!.Period);
        Assert.Equal(334, DepreciationMath.Calculate(lot, new(2026, 3, 1), new(2026, 3, 31))!.Period);
        var final = DepreciationMath.Calculate(lot, new(2026, 4, 1), new(2027, 1, 1))!;
        Assert.Equal(1000, final.Accumulated);
        Assert.Equal(100, final.CarryingValue);
        var retired = lot with { Revisions = [lot.Revisions[0] with { Plan = plan with { RetiredOn = new(2026, 4, 15) } }] };
        Assert.Equal(667, DepreciationMath.Calculate(retired, start, new(2027, 1, 1))!.Accumulated);
    }
}
