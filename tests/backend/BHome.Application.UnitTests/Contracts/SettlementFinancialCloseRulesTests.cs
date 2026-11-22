using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class SettlementFinancialCloseRulesTests
{
    [Fact]
    public void MissingKeyRequiresReviewEvenWithNoEvidencePhoto()
    {
        var opening = new[] { new HandoverAccessItem("RoomKey", 3, "") };
        var returned = new[] { new HandoverAccessItem("RoomKey", 2, "") };
        Assert.True(SettlementFinancialCloseRules.MissingRoomKeys(opening, returned));
        Assert.False(SettlementFinancialCloseRules.MissingRoomKeys(opening,
            [new HandoverAccessItem("RoomKey", 3, "")]));
        Assert.False(SettlementFinancialCloseRules.MissingRoomKeys(null, returned));
        Assert.False(SettlementFinancialCloseRules.MissingRoomKeys(opening, null));
    }
    private static readonly string Asset = "asset:11111111-1111-4111-8111-111111111111";
    private static readonly string Room = "room:walls_ceiling_floor";
    private static readonly string Keys = "room:access_room_key";

    [Fact]
    public void PricingMustCoverEveryNewObservedIssueOrHaveAnExplicitOwnerWaiver()
    {
        var issues = new[] { Asset, Room, Keys };
        Assert.False(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], []));
        Assert.False(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], [Room]));
        Assert.True(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], [Room, Keys]));
        Assert.True(SettlementFinancialCloseRules.CompletePricing(issues, issues, []));
    }

    [Fact]
    public void UnknownDuplicateAndAlreadyPricedWaiversAreAlwaysRejected()
    {
        var issues = new[] { Asset, Room };
        Assert.False(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], [Room, Room]));
        Assert.False(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], [Room, "room:unobserved"]));
        Assert.False(SettlementFinancialCloseRules.CompletePricing(issues, [Asset], [Room, Asset]));
        Assert.False(SettlementFinancialCloseRules.CompletePricing([], [], [Room]));
    }

    [Fact]
    public void ChildIdempotencyKeysAreStableAndDistinctForEachFinancialSource()
    {
        var ownerAction = Guid.NewGuid();
        var damage = Guid.NewGuid();
        var secondDamage = Guid.NewGuid();
        var first = SettlementFinancialCloseRules.ChildKey(ownerAction, damage, "offset");
        Assert.NotEqual(Guid.Empty, first);
        Assert.Equal(first, SettlementFinancialCloseRules.ChildKey(ownerAction, damage, "offset"));
        Assert.NotEqual(first, SettlementFinancialCloseRules.ChildKey(ownerAction, damage, "refund"));
        Assert.NotEqual(first, SettlementFinancialCloseRules.ChildKey(ownerAction, secondDamage, "offset"));
        Assert.NotEqual(first, SettlementFinancialCloseRules.ChildKey(Guid.NewGuid(), damage, "offset"));
    }

    [Fact]
    public void NoAdditionalDamageNeverBypassesApprovalOfExistingFinalCharges()
    {
        var review = Guid.NewGuid();
        Assert.False(SettlementFinancialCloseRules.ReviewComplete(true, 2, false, null, null));
        Assert.False(SettlementFinancialCloseRules.ReviewComplete(true, 2, true, null, null));
        Assert.True(SettlementFinancialCloseRules.ReviewComplete(true, 2, true, review, null));
        Assert.False(SettlementFinancialCloseRules.ReviewComplete(false, 1, true, review, null));
        Assert.True(SettlementFinancialCloseRules.ReviewComplete(false, 1, true, review, review));
        Assert.False(SettlementFinancialCloseRules.ReviewComplete(false, 1, false, review, review));
        Assert.True(SettlementFinancialCloseRules.ReviewComplete(true, 0, false, null, null));
        Assert.False(SettlementFinancialCloseRules.ReviewComplete(true, 0, false, null, review));
    }

    [Fact]
    public void JoiningNestedMoneyTransactionsIsRestrictedToTheScopeAndRestoredOnDispose()
    {
        Assert.False(SettlementFinancialCloseTransactionContext.Active);
        using (SettlementFinancialCloseTransactionContext.Enter())
        {
            Assert.True(SettlementFinancialCloseTransactionContext.Active);
            using (SettlementFinancialCloseTransactionContext.Enter())
                Assert.True(SettlementFinancialCloseTransactionContext.Active);
            Assert.True(SettlementFinancialCloseTransactionContext.Active);
        }
        Assert.False(SettlementFinancialCloseTransactionContext.Active);
    }
}
