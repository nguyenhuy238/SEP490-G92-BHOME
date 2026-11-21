using BHome.Application.Finance;

namespace BHome.Application.UnitTests.Finance;

public sealed class AssetCapitalMathTests
{
    [Fact]
    public void BeforeFirstJob_HistoricalQuantityAndPriceVersionsRemainDistinct()
    {
        var id = Guid.NewGuid();
        var history = new[]
        {
            new AssetCapitalRevision(1, 2, 2_000_000, new(2026, 1, 10)),
            new AssetCapitalRevision(2, 3, 2_500_000, new(2026, 3, 15))
        };
        var pending = AssetCapitalMath.Pending(id, 3, 2_500_000, null, 2, history, [], false);
        Assert.Equal(2, pending.Count);
        Assert.Equal(new[] { 4_000_000m, 2_500_000m }, pending.Select(p => p.Amount));
        Assert.Equal(6_500_000m, pending.Sum(p => p.Amount));
        Assert.Equal(new[] { 2, 1 }, pending.Select(p => p.Quantity));
        Assert.Equal(new[] { 1, 2 }, pending.Select(p => p.MetadataVersion));
        Assert.Equal(new DateOnly(2026, 1, 10), pending[0].PurchaseDate);
    }

    [Fact]
    public void AfterBaseWasCommitted_OnlyIncrementIsPending_ReplayCannotDoubleCount()
    {
        var id = Guid.NewGuid();
        var history = new[]
        {
            new AssetCapitalRevision(1, 2, 2_000_000, null),
            new AssetCapitalRevision(2, 3, 2_500_000, null)
        };
        var baseline = new AssetCapitalPosted($"asset-capital:{id:N}:base", 2, 2_000_000, 4_000_000, 1);
        var pending = AssetCapitalMath.Pending(id, 3, 2_500_000, null, 2, history, [baseline], false);
        var increment = Assert.Single(pending);
        Assert.Equal(2_500_000m, increment.Amount);
        Assert.Equal(1, increment.Quantity);
        var committed = new AssetCapitalPosted(increment.SourceKey, increment.Quantity,
            increment.UnitCost, increment.Amount, increment.MetadataVersion);
        Assert.Empty(AssetCapitalMath.Pending(id, 3, 2_500_000, null, 2,
            history, [baseline, committed], false));
    }

    [Fact]
    public void PriceOnlyEditsDoNotRevalue_ShrinkAndRepurchaseRecordsActualNewUnits()
    {
        var id = Guid.NewGuid();
        var baseline = new AssetCapitalPosted($"asset-capital:{id:N}:base", 2, 2_000_000, 4_000_000, 1);
        var history = new[]
        {
            new AssetCapitalRevision(1, 2, 2_000_000, null),
            new AssetCapitalRevision(2, 2, 2_700_000, null),
            new AssetCapitalRevision(3, 1, 2_700_000, null),
            new AssetCapitalRevision(4, 2, 3_000_000, null)
        };
        var pending = AssetCapitalMath.Pending(id, 2, 3_000_000, null, 4, history, [baseline], false);
        Assert.Equal(3_000_000, Assert.Single(pending).Amount);
        Assert.EndsWith(":version:4", pending[0].SourceKey);
        Assert.Empty(AssetCapitalMath.Pending(id, 2, 3_000_000, null, 4, history, [baseline], true));
    }

    [Fact]
    public void MissingPurchasePricePreventsAutomaticValuationUntilRecorded()
    {
        var id = Guid.NewGuid();
        Assert.Empty(AssetCapitalMath.Pending(id, 2, null, null, 1,
            [new AssetCapitalRevision(1, 2, null, null)], [], false));
        var pending = AssetCapitalMath.Pending(id, 2, 2_000_000, null, 2,
            [new AssetCapitalRevision(1, 2, null, null), new AssetCapitalRevision(2, 2, 2_000_000, null)],
            [], false);
        Assert.Equal(4_000_000, Assert.Single(pending).Amount);
    }

    [Fact]
    public void ExistingBareLegacySourceKeyAlreadyAccountsForOriginalPurchase()
    {
        var id = Guid.NewGuid();
        var history = new[]
        {
            new AssetCapitalRevision(1, 2, 2_000_000, new(2026, 1, 10)),
            new AssetCapitalRevision(2, 3, 2_500_000, new(2026, 3, 15))
        };
        var bare = new AssetCapitalPosted($"asset-capital:{id:N}", 2, 2_000_000, 4_000_000, 1);
        var additional = Assert.Single(AssetCapitalMath.Pending(
            id, 3, 2_500_000, null, 2, history, [bare], false));
        Assert.Equal(2_500_000m, additional.Amount);
        Assert.Equal(1, additional.Quantity);
        Assert.Equal($"asset-capital:{id:N}:version:2", additional.SourceKey);
    }

    [Fact]
    public void OriginallyUnpricedUnitsAreNotRepricedAtLaterAddedUnitCost()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, null, new(2026, 1, 2)),
            new AssetCapitalRevision(2, 3, 2_500_000, new(2026, 4, 3)),
            new AssetCapitalRevision(3, 4, 3_000_000, new(2026, 5, 4))
        };
        var pending = AssetCapitalMath.Pending(id, 4, 3_000_000, null, 3, revisions, [], false);
        Assert.Equal(new[] { 2_500_000m, 3_000_000m }, pending.Select(p => p.Amount));
        Assert.Equal(5_500_000m, pending.Sum(p => p.Amount));
        Assert.True(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));
        var firstPosted = new AssetCapitalPosted(pending[0].SourceKey,
            pending[0].Quantity, pending[0].UnitCost, pending[0].Amount, pending[0].MetadataVersion);
        var remaining = Assert.Single(AssetCapitalMath.Pending(id, 4, 3_000_000, null, 3, revisions, [firstPosted], false));
        Assert.Equal(3_000_000m, remaining.Amount);
    }

    [Fact]
    public void ZeroCostOriginalQuantity_IsPricedFreeAndCreatesNoZeroValueLedgerEvents()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, 0m, new(2026, 1, 10))
        };

        Assert.Empty(AssetCapitalMath.Pending(id, 2, 0m, null, 1, revisions, [], false));
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));
        // Also handle physical assets without a metadata revision document.
        Assert.Empty(AssetCapitalMath.Pending(id, 2, 0m, null, 0, [], [], false));
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice([], []));
    }

    [Fact]
    public void ZeroCostOriginalTwo_ThenOneNewUnitAtTwoMillion_OnlyPostsTwoMillion()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, 0m, new(2026, 1, 10)),
            new AssetCapitalRevision(2, 3, 2_000_000m, new(2026, 3, 15))
        };
        var pending = Assert.Single(AssetCapitalMath.Pending(id, 3, 2_000_000m,
            null, 2, revisions, [], false));
        Assert.Equal(1, pending.Quantity);
        Assert.Equal(2_000_000m, pending.UnitCost);
        Assert.Equal(2_000_000m, pending.Amount);
        Assert.Equal(2, pending.MetadataVersion);
        Assert.EndsWith(":version:2", pending.SourceKey);
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));

        // After the positive increment is posted, a job retry must not
        // produce a base event or a second acquisition.
        var posted = new AssetCapitalPosted(pending.SourceKey, pending.Quantity,
            pending.UnitCost, pending.Amount, pending.MetadataVersion);
        Assert.Empty(AssetCapitalMath.Pending(id, 3, 2_000_000m,
            null, 2, revisions, [posted], false));
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice(revisions, [posted]));
    }

    [Fact]
    public void LaterPriceOnlyEdit_NeverRevaluesPreviouslyFreeAddedUnits()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, 0m, null),
            new AssetCapitalRevision(2, 3, 0m, null),
            new AssetCapitalRevision(3, 3, 2_000_000m, null),
            new AssetCapitalRevision(4, 4, 3_000_000m, null)
        };
        var posted = Assert.Single(AssetCapitalMath.Pending(id, 4, 3_000_000m,
            null, 4, revisions, [], false));
        Assert.Equal(1, posted.Quantity);
        Assert.Equal(3_000_000m, posted.Amount);
        Assert.Equal(4, posted.MetadataVersion);
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));
    }

    [Fact]
    public void UnknownOriginalQuantityStillUnpriced_WhenLaterAddedUnitsAreFree()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, null, null),
            new AssetCapitalRevision(2, 3, 0m, null),
            new AssetCapitalRevision(3, 4, 2_000_000m, null)
        };
        var pending = Assert.Single(AssetCapitalMath.Pending(id, 4, 2_000_000m,
            null, 3, revisions, [], false));
        Assert.Equal(1, pending.Quantity);
        Assert.Equal(2_000_000m, pending.Amount);
        Assert.True(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));
    }

    [Fact]
    public void PriceRecordedAsZeroAfterUnknownSameQuantity_ResolvesMissingPriceWithoutLedger()
    {
        var id = Guid.NewGuid();
        var revisions = new[]
        {
            new AssetCapitalRevision(1, 2, null, null),
            new AssetCapitalRevision(2, 2, 0m, null),
            new AssetCapitalRevision(3, 3, 2_000_000m, null)
        };
        var pending = Assert.Single(AssetCapitalMath.Pending(id, 3, 2_000_000m,
            null, 3, revisions, [], false));
        Assert.Equal(1, pending.Quantity);
        Assert.Equal(2_000_000m, pending.Amount);
        Assert.False(AssetCapitalMath.HasMissingHistoricalPrice(revisions, []));
    }
}
