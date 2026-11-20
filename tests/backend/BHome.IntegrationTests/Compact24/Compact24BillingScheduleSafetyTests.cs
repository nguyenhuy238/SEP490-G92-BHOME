using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24BillingScheduleSafetyTests
{
    private static async Task Run(Func<PaymentLedgerTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await scenario(new PaymentLedgerTests(fixture.Capture)); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public Task FutureFinancialPlanAndSamePeriodNoOp() =>
        Run(t => t.FutureFinancialPlansPreserveUngeneratedPeriodsAndSamePeriodSavesAreNoOps());

    [CompactPostgresFact]
    public Task InitialSchedule() => Run(t => t.FirstAutomationSaveCreatesBillingScheduleAtomicallyWithoutPricingPage());

    [CompactPostgresFact]
    public Task LegacyScheduleVersionAndFinancialRules() =>
        Run(t => t.EditingExistingAutomationUpdatesFinancialRulesAtomicallyWithoutChangingOldSnapshots());

    [CompactPostgresFact]
    public Task EarlierCalendarOverrides() => Run(t => t.ManualOnlyEffectiveCalendarOverridesPreserveFallbackAndEarlierPeriods());

    [CompactPostgresFact]
    public Task LegacyPutBeforeSamePeriodAuthorization() =>
        Run(t => t.ManualAndScheduledFinalizationCommitOneImmutableInvoiceAndIssuanceEvent());
}
