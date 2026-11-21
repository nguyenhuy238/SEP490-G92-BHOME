using BHome.IntegrationTests.Billing;

namespace BHome.IntegrationTests.Compact24;

public sealed class FinalUtilityRegressionTests
{
    [CompactPostgresFact]
    public async Task FullyOffsetDepositDoesNotCreateAFictitiousRefund()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(reviewRefund: true, offsetAllDeposit: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task OwnerReviewsChargesAndRefundsOnlyTheDepositRemainingAfterOffsets()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(reviewRefund: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task BillableBaselineAndCumulativeTieredPricing()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task SettlementBeforeInvoiceDoesNotBillTheSameConsumptionAgain()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task MissingQuotaOrAlteredPhotosCannotCreateAnOfficialCharge()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(failuresOnly: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task ConcurrentSettlementAndInvoiceCannotDoubleChargeUsage()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(raceInvoice: true); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task DifferentRoomContractsCanConfirmFinalReadingsOnTheSameDay()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new InvoiceApiTests(fixture.Capture).FinalUtilitiesUseBilledBaselineAndPreserveContractRates(sameDayFinals: true); }
        finally { await fixture.DisposeAsync(); }
    }
}
