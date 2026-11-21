using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class HandoverBaselineTests
{
    private static readonly Guid Group = Guid.NewGuid(), Old = Guid.NewGuid(), New = Guid.NewGuid(), Contract = Guid.NewGuid(), Tenant = Guid.NewGuid();
    private static HandoverSnapshot Original()
    {
        var reading = new HandoverReading(Guid.NewGuid(), "SYN", 0, new(2026, 11, 16), 100, Guid.NewGuid(), "private", "hash");
        return new(new(2026, 11, 16), "SYN", "Synthetic", "Keys", "", [new(Group, "Ghế", "Tốt", "Tốt", Group, 4, "cái", "BulkQuantity",
            [new(Old, 1, 4, "Tốt", "Active")], true, 3, 3, 3, 0, 0, 1)], reading, reading with { UtilityType = 1 }, []);
    }
    [Fact]
    public void DamagePricingRequiresNewVerifiedLossComparedToMoveIn()
    {
        var baseline = new HandoverAsset(Guid.NewGuid(), "Synthetic chair", "Good", "Good",
            HandedOverQuantity: 4, ObservedQuantity: 4, GoodQuantity: 3,
            DamagedQuantity: 1, MissingQuantity: 0, Checked: true);
        Assert.False(HandoverChecklist.NewDamageAgainstBaseline(baseline, baseline));
        Assert.False(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { DamagedQuantity = 1 }, baseline));
        Assert.False(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { DamagedQuantity = 2 }, null));
        Assert.False(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { DamagedQuantity = 2, Checked = false }, baseline));
        Assert.True(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { DamagedQuantity = 2 }, baseline));
        Assert.True(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { MissingQuantity = 1 }, baseline));
        Assert.True(HandoverChecklist.NewDamageAgainstBaseline(
            baseline with { HandedOverQuantity = 3 }, baseline));
    }
    private static AssetChangeView Change(string kind, int added, int withdrawn, Guid? old, Guid? next) => new(Guid.NewGuid(), 1, "Confirmed",
        new(Guid.NewGuid(), Guid.NewGuid(), kind, new(2026, 11, 16), "Synthetic approved operation", Guid.NewGuid(),
            [new(Group, old, next, added, withdrawn, "Tốt", [])], [Original().Assets[0] with { PhysicalAssets = [new(next ?? Old, 2, 4, "Tốt", "Active")] }],
            [new(Contract, Tenant)], [new(Contract, Tenant, DateTimeOffset.UtcNow, true, "")], Contract, DateTimeOffset.UtcNow));
    [Fact]
    public void AdditionUsesActuallyHandedQuantityAndNeverRewritesOriginalSnapshot()
    {
        var original = Original(); var change = Change("Supplement", 1, 0, null, Old);
        var actual = HandoverBaseline.Apply(original, [change, change]);
        Assert.Equal(4, Assert.Single(actual.Assets).HandedOverQuantity);
        Assert.Equal(4, Assert.Single(actual.Assets[0].PhysicalAssets!).Quantity);
        Assert.Equal(3, original.Assets[0].HandedOverQuantity); Assert.Equal(4, original.Assets[0].PhysicalAssets![0].Quantity);
    }
    [Fact]
    public void SharedEventUsesPhysicalIdentityWhenTenantsHaveDifferentHistoricalGroupIds()
    {
        var original = Original(); var ownGroup = Guid.NewGuid();
        original = original with { Assets = [original.Assets[0] with { Id = ownGroup }] };
        var result = HandoverBaseline.Apply(original, [Change("Supplement", 1, 0, null, Old)]);
        var asset = Assert.Single(result.Assets); Assert.Equal(ownGroup, asset.Id); Assert.Equal(4, asset.HandedOverQuantity);
        Assert.Single(asset.PhysicalAssets!);
    }
    [Fact]
    public void AdditionPreservesEarlierDamageDescriptionWithoutInventingAnUpdatedConditionSplit()
    {
        var original = Original(); original = original with { Assets = [original.Assets[0] with { ObservedCondition = "Một ghế đã hỏng trước khi thuê", DamagedQuantity = 1, GoodQuantity = 2 }] };
        var actual = Assert.Single(HandoverBaseline.Apply(original, [Change("Supplement", 1, 0, null, Old)]).Assets);
        Assert.Contains("đã hỏng trước khi thuê", actual.ObservedCondition); Assert.Contains("Bổ sung", actual.ObservedCondition);
        Assert.Equal(4, actual.HandedOverQuantity); Assert.Null(actual.GoodQuantity); Assert.Null(actual.DamagedQuantity);
        Assert.Equal(1, original.Assets[0].DamagedQuantity);
    }
    [Fact]
    public void ReplacementRemovesOldIdentitySoItCannotBeReportedMissing()
    {
        var actual = HandoverBaseline.Apply(Original(), [Change("Replacement", 3, 3, Old, New)]);
        Assert.Equal(3, Assert.Single(actual.Assets).HandedOverQuantity); Assert.Equal(New, Assert.Single(actual.Assets[0].PhysicalAssets!).Id);
    }
    [Fact]
    public void AuthorizedWithdrawalReducesExpectedQuantity()
    {
        var actual = HandoverBaseline.Apply(Original(), [Change("Withdrawal", 0, 1, Old, null)]);
        Assert.Equal(2, Assert.Single(actual.Assets).HandedOverQuantity); Assert.Equal(2, Assert.Single(actual.Assets[0].PhysicalAssets!).Quantity);
    }
    [Fact]
    public void EntireWithdrawalRemovesGroupAndDuplicateEventDoesNotMultiplyIt() =>
        Assert.Empty(HandoverBaseline.Apply(Original(), [Change("Withdrawal", 0, 3, Old, null)]).Assets);
    [Fact]
    public void UnknownHistoricalQuantityRemainsUnknownAfterAddition()
    {
        var original = Original(); original = original with { Assets = [original.Assets[0] with { HandedOverQuantity = null }] };
        Assert.Null(Assert.Single(HandoverBaseline.Apply(original, [Change("Supplement", 1, 0, null, Old)]).Assets).HandedOverQuantity);
    }
    [Fact]
    public void InvalidWithdrawalCannotMakeNegativeResponsibility() =>
        Assert.Throws<ContractException>(() => HandoverBaseline.Apply(Original(), [Change("Withdrawal", 0, 4, Old, null)]));
}
