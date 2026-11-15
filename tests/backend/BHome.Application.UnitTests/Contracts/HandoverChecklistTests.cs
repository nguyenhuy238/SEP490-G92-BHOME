using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class HandoverChecklistTests
{
    private static readonly Guid Group = Guid.NewGuid(), Asset = Guid.NewGuid(), Evidence = Guid.NewGuid();
    private static HandoverAsset Source => new(Group, "Ghế", "Tốt", "", Group, 4, "cái", "BulkQuantity", [new(Asset, 1, 4, "Tốt", "Active")], true);
    private static HandoverAssetInput Valid => new(Group, "Hai tốt, một hao mòn", 3, 3, 2, 1, 0, 1, true, "Thiếu một ghế", [Evidence]);
    [Fact] public void MissingAndDamagedQuantitiesRemainSeparate()
    {
        var actual = Assert.Single(HandoverChecklist.Inspect([Source], [Valid], true));
        Assert.Equal(3, actual.ObservedQuantity); Assert.Equal(1, actual.MissingQuantity); Assert.Equal(0, actual.DamagedQuantity);
        Assert.True(HandoverChecklist.Problem(actual)); Assert.Equal(Asset, Assert.Single(actual.PhysicalAssets!).Id);
    }
    [Theory]
    [InlineData(-1, 3, 2, 1, 0, 1)] [InlineData(3, 4, 2, 1, 0, 1)] [InlineData(3, 3, 3, 1, 0, 1)]
    [InlineData(3, 3, 2, 1, 0, 0)] [InlineData(10001, 3, 10000, 1, 0, 0)]
    public void InvalidQuantitiesAreRejected(int observed, int handed, int good, int worn, int damaged, int missing) =>
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source], [Valid with { ObservedQuantity = observed, HandedOverQuantity = handed,
            GoodQuantity = good, WornQuantity = worn, DamagedQuantity = damaged, MissingQuantity = missing }], true));
    [Fact] public void IncompleteAndForeignGroupsAreRejected()
    {
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source], [], true));
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source], [Valid with { Id = Guid.NewGuid() }], true));
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source, Source], [Valid, Valid], true));
    }
    [Fact] public void ProblemRequiresItsOwnEvidence() => Assert.Equal("asset_group_evidence_required",
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source], [Valid with { EvidenceIds = [] }], true)).Code);
    [Fact] public void WithheldQuantityRequiresReason() => Assert.Equal("withheld_asset_reason_required",
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([Source], [Valid with { HandedOverQuantity = 2, Notes = "" }], true)).Code);
    [Fact] public void LegacyConditionHasNoInventedQuantities()
    {
        var actual = Assert.Single(HandoverChecklist.Inspect([new(Group, "Cũ", "", "")], [new(Group, "Đã kiểm tra")], false));
        Assert.Null(actual.ObservedQuantity); Assert.Null(actual.HandedOverQuantity);
    }
    [Fact] public void MultiplePhysicalAssetsRetainStableIdentities()
    {
        var second = Guid.NewGuid();
        var source = Source with { PhysicalAssets = [new(Asset, 1, 2, "Tốt", "Active"), new(second, 3, 2, "Tốt", "Active")] };
        var actual = Assert.Single(HandoverChecklist.Inspect([source], [Valid with { PhysicalObservations = [new(Asset, 2, "Tốt"), new(second, 1, "Hao mòn")] }], true));
        Assert.Equal(2, actual.PhysicalAssets!.Length); Assert.Equal(second, actual.PhysicalObservations![1].Id);
        Assert.Throws<ContractException>(() => HandoverChecklist.Inspect([source], [Valid with { PhysicalObservations = [new(Asset, 3, "Tốt")] }], true));
    }
}
