using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24BillingManualActionsTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public Task DevelopmentManualActions() => new PaymentLedgerTests(fixture.Capture)
        .DeveloperManualMeterTaskUsesEffectivePlanDayEvenWhenPlanIsDisabled();

    [CompactPostgresFact]
    public Task StagingManualActions() => new PaymentLedgerTests(fixture.Capture)
        .DeveloperManualMeterTaskUsesEffectivePlanDayEvenWhenPlanIsDisabled(true);
}
