using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;

namespace BHome.Application.UnitTests.Contracts;

public sealed class UtilityIncrementCalculationTests
{
    private sealed class Pricing(decimal free = 10, int version = 1) : IUtilityBilling
    {
        public Task<UtilityCalculation?> CalculateAsync(Guid roomId, UtilityType type, DateOnly period, decimal quantity, CancellationToken token)
        {
            var billable = Math.Max(0, quantity - free);
            var amount = Math.Min(50, billable) * 100 + Math.Max(0, billable - 50) * 200;
            return Task.FromResult<UtilityCalculation?>(new(amount, JsonSerializer.Serialize(new
            {
                profileId = "synthetic-profile",
                profileVersion = 1,
                tariffId = "synthetic-tariff",
                tariffVersion = version,
                quotaId = "synthetic-quota",
                quotaVersion = 1,
                free,
                quantity,
                amount
            }), []));
        }
    }
    private static Task<UtilityCalculation?> Increment(IUtilityBilling billing, decimal previous, decimal additional, string? snapshot) =>
        UtilityIncrementCalculation.CalculateAsync(billing, Guid.NewGuid(), UtilityType.Electricity, new(2026, 11, 1), previous, additional, snapshot, default);
    private static async Task<string> Snapshot(IUtilityBilling billing, decimal quantity) =>
        (await billing.CalculateAsync(Guid.NewGuid(), UtilityType.Electricity, new(2026, 11, 1), quantity, default))!.Snapshot;

    [Fact]
    public async Task AdditionalUsageDoesNotRestartTheLowTierOrApplyFreeQuotaTwice()
    {
        var pricing = new Pricing();
        var result = await Increment(pricing, 100, 50, await Snapshot(pricing, 100));
        Assert.Empty(result!.MissingInputs); Assert.Equal(10000, result.Amount);
        Assert.NotEqual((await pricing.CalculateAsync(Guid.NewGuid(), UtilityType.Electricity, new(2026, 11, 1), 50, default))!.Amount, result.Amount);
    }
    [Fact]
    public async Task PreviouslyUnusedFreeQuotaIsConsumedOnlyOnceAcrossCharges()
    {
        var pricing = new Pricing(100);
        var result = await Increment(pricing, 50, 75, await Snapshot(pricing, 50));
        Assert.Empty(result!.MissingInputs); Assert.Equal(2500, result.Amount);
    }
    [Fact]
    public async Task ChangedHistoricalPricingRequiresReviewInsteadOfRepricingThePast()
    {
        var result = await Increment(new Pricing(version: 2), 100, 50, await Snapshot(new Pricing(), 100));
        Assert.Contains("utility_increment_policy_changed", result!.MissingInputs); Assert.Equal(0, result.Amount);
    }
    [Fact]
    public async Task MissingHistoricalPricingCannotBeReconstructedFromTodaysPolicy()
    {
        var result = await Increment(new Pricing(), 100, 50, null);
        Assert.Contains("utility_pricing_baseline_required", result!.MissingInputs);
    }
    [Fact]
    public async Task SubsequentChargesUseTheCumulativeSnapshotWithoutGrowingARecursiveHistory()
    {
        var pricing = new Pricing();
        var first = await Increment(pricing, 100, 50, await Snapshot(pricing, 100));
        var second = await Increment(pricing, 150, 10, first!.Snapshot);
        Assert.Empty(second!.MissingInputs); Assert.Equal(2000, second.Amount);
        using var json = JsonDocument.Parse(second.Snapshot);
        Assert.DoesNotContain("CumulativeUtilityIncrement/v1", json.RootElement.GetProperty("previousPolicySnapshot").GetString());
    }
    [Fact]
    public async Task AlreadyPricedReadingProducesAZeroIncrement()
    {
        var pricing = new Pricing(); var result = await Increment(pricing, 100, 0, await Snapshot(pricing, 100));
        Assert.Empty(result!.MissingInputs); Assert.Equal(0, result.Amount);
    }
    private sealed class Segments(bool rewriteHistory = false) : IUtilityBilling
    {
        public Task<UtilityCalculation?> CalculateAsync(Guid roomId, UtilityType type, DateOnly period, decimal quantity, CancellationToken token)
        {
            var amount = Math.Max(0, quantity - (rewriteHistory ? 0 : 10)) * 100;
            return Task.FromResult<UtilityCalculation?>(new(amount, JsonSerializer.Serialize(new
            {
                breakdownId = "synthetic-breakdown",
                breakdownVersion = quantity == 100 ? 1 : 2,
                quotaId = "synthetic-quota",
                quotaVersion = 1,
                segments = new[] { new { from = "2026-11-01", to = quantity == 100 ? "2026-11-15" : "2026-11-30", tariffId = "synthetic-tariff", tariffVersion = 1,
                    tiers = new[] { new { unitPrice = 100 } }, rounding = 0, consumption = quantity, freeQuantity = rewriteHistory ? 0 : 10, amount } },
                amount
            }), []));
        }
    }
    [Fact]
    public async Task OwnerConfirmedSegmentsCanExtendWithoutRewritingPriorTierOrQuotaAllocation()
    {
        var pricing = new Segments(); var result = await Increment(pricing, 100, 50, await Snapshot(pricing, 100));
        Assert.Empty(result!.MissingInputs); Assert.Equal(5000, result.Amount);
        var changed = await Increment(new Segments(true), 100, 50, await Snapshot(pricing, 100));
        Assert.Contains("utility_increment_policy_changed", changed!.MissingInputs);
    }
}
