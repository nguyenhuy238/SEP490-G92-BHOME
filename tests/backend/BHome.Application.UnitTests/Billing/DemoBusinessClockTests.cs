using BHome.Application.Common;
using BHome.Application.Billing;

namespace BHome.Application.UnitTests.Billing;

public sealed class DemoBusinessClockTests
{
    [Fact]
    public void SimulatesVietnamBusinessDateWithoutChangingSecurityTimeOrTimers()
    {
        var real = new Clock(new DateTimeOffset(2026, 11, 24, 18, 30, 0, TimeSpan.Zero));
        var demo = new DemoBusinessClock(real);
        Assert.False(demo.Read().Simulated);
        Assert.Equal(new DateOnly(2026, 11, 25), demo.BusinessToday());
        var changed = demo.Change(new DateOnly(2026, 11, 1), 0)!;
        Assert.Equal(1, changed.Version);
        Assert.True(changed.Simulated);
        Assert.Equal(new DateOnly(2026, 11, 1), demo.BusinessToday());
        Assert.Equal(new DateTimeOffset(2026, 10, 31, 18, 30, 0, TimeSpan.Zero), demo.BusinessUtcNow());
        Assert.Equal(real.GetUtcNow(), demo.GetUtcNow());
        Assert.Equal(real.GetTimestamp(), demo.GetTimestamp());
        Assert.Null(demo.Change(new DateOnly(2026, 12, 1), 0));
        Assert.Equal(new DateOnly(2026, 11, 1), demo.Read().BusinessDate);
        var reset = demo.Change(null, changed.Version)!;
        Assert.Equal(2, reset.Version);
        Assert.False(reset.Simulated);
        Assert.Equal(real.GetUtcNow(), demo.BusinessUtcNow());
    }

    [Fact]
    public void NormalProviderDoesNotSimulateTime()
    {
        var real = new Clock(new DateTimeOffset(2026, 11, 24, 17, 0, 0, TimeSpan.Zero));
        Assert.Equal(real.GetUtcNow(), real.BusinessUtcNow());
        Assert.Equal(new DateOnly(2026, 11, 25), real.BusinessToday());
    }

    [Fact]
    public void StagingClockAllowsOnlyDesignatedOwnerIndividualActionsWithoutEnablingDeveloperBatches()
    {
        var owner = Guid.NewGuid();
        var staging = new BillingAutomationRuntime(false, false, owner, true);
        Assert.True(staging.AllowsManualActions(owner, true));
        Assert.False(staging.AllowsManualActions(owner, false));
        Assert.False(staging.AllowsManualActions(Guid.NewGuid(), true));
        Assert.False(staging.AllowsManualActions(null, true));
        Assert.False(staging.DeveloperActionsEnabled);
        Assert.False(staging.WorkerEnabled);
        Assert.False(new BillingAutomationRuntime(false).AllowsManualActions(owner, true));
        Assert.True(new BillingAutomationRuntime(true).AllowsManualActions(owner, true));
    }

    [Fact]
    public void DeployedAcademicClockSupportsManualActionsWithoutDeveloperBatches()
    {
        var runtime = new BillingAutomationRuntime(false, false, DeployedDemoEnabled: true);
        Assert.True(runtime.AllowsManualActions(Guid.NewGuid(), true));
        Assert.False(runtime.AllowsManualActions(Guid.NewGuid(), false));
        Assert.False(runtime.AllowsManualActions(null, true));
        Assert.False(runtime.DeveloperActionsEnabled);
        Assert.False(runtime.WorkerEnabled);
    }

    [Fact]
    public void ExactDemoTimeTicksAcrossMidnightAndResetPreservesRealClock()
    {
        var real = new Clock(new DateTimeOffset(2026, 11, 24, 18, 30, 0, TimeSpan.Zero));
        var demo = new DemoBusinessClock(real);
        var target = new DateTimeOffset(2026, 12, 24, 23, 59, 58, TimeSpan.FromHours(7));
        var changed = demo.ChangeTime(target, 0)!;
        Assert.Equal(target, changed.BusinessTime);
        real.Advance(TimeSpan.FromSeconds(3));
        Assert.Equal(new DateOnly(2026, 12, 25), demo.BusinessToday());
        Assert.Equal(target.AddSeconds(3), demo.Read().BusinessTime);
        Assert.Equal(real.GetUtcNow(), demo.GetUtcNow());
        Assert.Null(demo.ChangeTime(target, 0));
        Assert.False(demo.ChangeTime(null, 1)!.Simulated);
        Assert.Equal(real.GetUtcNow(), demo.BusinessUtcNow());
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public void Advance(TimeSpan elapsed) => now += elapsed;
        public override DateTimeOffset GetUtcNow() => now;
        public override long GetTimestamp() => 123;
    }
}
