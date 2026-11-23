using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class MoveOutProposalSettlementRulesTests
{
    [Theory]
    [InlineData(1_000_000, true, 1_500_000)]
    [InlineData(1_000_000, true, 800_000)]
    [InlineData(1_000_000, true, 1_000_000)]
    [InlineData(1_000_000, true, 300_000, 1_200_000)]
    [InlineData(1_000_000, false, 750_000, 750_000, 750_000)]
    [InlineData(0, true, 500_000)]
    [InlineData(0, false, 500_000, 500_000)]
    public void BankTransferNeedsAtMostOneRemainingReceivable(decimal deposit,
        bool expected, params int[] chargeAmounts)
    {
        Assert.Equal(expected, MoveOutProposalSettlementRules.OnePayableAfterDeposit(
            chargeAmounts.Select(amount => (decimal)amount), deposit));
    }

    [Fact]
    public void InvalidDepositOrChargeNeverAllowsAutomaticAllocation()
    {
        Assert.False(MoveOutProposalSettlementRules.OnePayableAfterDeposit([100_000m], -1));
        Assert.False(MoveOutProposalSettlementRules.OnePayableAfterDeposit([0m], 0));
        Assert.False(MoveOutProposalSettlementRules.OnePayableAfterDeposit([10.5m], 50));
        Assert.False(MoveOutProposalSettlementRules.OnePayableAfterDeposit([100m, -10m], 50));
    }

    [Fact]
    public void OnlyOfferedUniqueItemsCanBeDisputedAndConfirmedItemsCannotBeDisputed()
    {
        var assetId = Guid.NewGuid();
        MoveOutProposedCharge[] offered =
        [
            new("Asset", assetId, null, null, 200_000, "Owner inspected damaged asset"),
            new("RoomCheck", null, "cleanliness", null, 100_000, "Owner inspected cleaning")
        ];
        var disputed = new MoveOutChargeProposalDisputedItem("RoomCheck", null, "cleanliness", null,
            "  Tenant disputes cleanliness  ");
        Assert.Equal("Tenant disputes cleanliness", Assert.Single(
            SettlementReceivablesService.NormalizeDisputedItems([disputed], offered, false)).Reason);
        Assert.Throws<ContractException>(() =>
            SettlementReceivablesService.NormalizeDisputedItems([disputed, disputed], offered, false));
        Assert.Throws<ContractException>(() =>
            SettlementReceivablesService.NormalizeDisputedItems([disputed], offered, true));
        Assert.Throws<ContractException>(() =>
            SettlementReceivablesService.NormalizeDisputedItems(
                [disputed with { RoomCheckCode = "walls_ceiling_floor" }], offered, false));
    }

    [Fact]
    public void RefundPetitionMustMatchCurrentVerifiedDepositAndHaveNoNewUnpaidInvoice()
    {
        var view = new SettlementReceivablesView(Guid.NewGuid(), Guid.NewGuid(), "verified-ref",
            200_000, [], []);
        var context = new SettlementChargeContext(view, Guid.NewGuid(), Guid.NewGuid(), 1,
            true, false, [], [], [], false);
        Assert.True(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(context, 200_000));
        Assert.False(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(context, 201_000));
        Assert.False(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(
            context with { View = view with { AvailableDeposit = 100_000 } }, 200_000));
        Assert.True(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(
            context with { InspectionConfirmed = false }, 200_000));
        Assert.False(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(
            context with { HasLegacyDeductions = true }, 200_000));
        Assert.False(MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(
            context with { View = view with { Invoices =
                [new SettlementOffsetInvoice(Guid.NewGuid(), new DateOnly(2026, 11, 1), 100_000, 0, 100_000)] } },
            200_000));
    }
}
