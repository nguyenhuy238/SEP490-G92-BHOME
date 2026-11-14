using BHome.IntegrationTests.Billing;
namespace BHome.IntegrationTests.Compact24;
public sealed class FinalFixedChargeRegressionTests
{
    [CompactPostgresFact]
    public async Task PersonMonthlySettlementThenInvoiceDoesNotDoubleCharge()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(personFee: true); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task PersonMonthlyFinalInvoiceThenSettlementDoesNotDoubleCharge()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(invoiceFirst: true, personFee: true); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task EarlierDepartureAfterFinalBillingRequiresAnApprovedRentAdjustment()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(correctedDeparture: true); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task PartialMonthRentPrecedesInvoiceWithoutDoubleBilling()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task FinalInvoiceRentIsNotChargedAgain()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(invoiceFirst: true); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task FullMonthRuleRequiresTheConfiguredChoice()
    { var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync(); try { await new InvoiceApiTests(fixture.Capture).FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(fullMonth: true); } finally { await fixture.DisposeAsync(); } }
}
