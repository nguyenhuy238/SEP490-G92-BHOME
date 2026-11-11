using BHome.IntegrationTests.Billing;

namespace BHome.IntegrationTests.Compact24;

public sealed class FinalUtilityRegressionTests
{
    [CompactPostgresFact]
    public async Task BillableBaselineAndCumulativeTieredPricing()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveCumulativeTiers(); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task SettlementBeforeInvoiceDoesNotBillTheSameConsumptionAgain()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveCumulativeTiers(true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task MissingQuotaOrAlteredPhotosCannotCreateAnOfficialCharge()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveCumulativeTiers(failuresOnly: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task ConcurrentSettlementAndInvoiceCannotDoubleChargeUsage()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveCumulativeTiers(raceInvoice: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task DifferentRoomContractsCanConfirmFinalReadingsOnTheSameDay()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveCumulativeTiers(sameDayFinals: true); }
        finally { await fixture.DisposeAsync(); }
    }
}
