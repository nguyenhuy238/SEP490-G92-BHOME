using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class MoveOutProposalSettlementRulesTests
{
    [Fact]
    public void VerifiedCompletionAcceptsEachQuotedPayableButNeverAnUnrelatedReceivable()
    {
        var electricity = Guid.NewGuid(); var water = Guid.NewGuid(); var covered = Guid.NewGuid();
        var settlement = new MoveOutProposalSettlement("Payable", 400_000, 0, null, [electricity, water, covered], [],
            PayableReceivables: [new(electricity, 100_000, "Electricity"), new(water, 300_000, "Water")]);
        Assert.True(MoveOutProposalSettlementRules.IsQuotedPayable(settlement, electricity));
        Assert.True(MoveOutProposalSettlementRules.IsQuotedPayable(settlement, water));
        Assert.False(MoveOutProposalSettlementRules.IsQuotedPayable(settlement, covered));
        Assert.False(MoveOutProposalSettlementRules.IsQuotedPayable(settlement, Guid.NewGuid()));
        Assert.False(MoveOutProposalSettlementRules.IsQuotedPayable(settlement with { Status = "Settled" }, water));
        Assert.False(MoveOutProposalSettlementRules.IsQuotedPayable(settlement with { CreatedReceivableIds = [electricity] }, water));
        Assert.True(MoveOutProposalSettlementRules.IsQuotedPayable(settlement with { PayableReceivables = null, PayableReceivableId = electricity }, electricity));
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
            context with
            {
                View = view with
                {
                    Invoices =
                [new SettlementOffsetInvoice(Guid.NewGuid(), new DateOnly(2026, 11, 1), 100_000, 0, 100_000)]
                }
            },
            200_000));
    }
}
