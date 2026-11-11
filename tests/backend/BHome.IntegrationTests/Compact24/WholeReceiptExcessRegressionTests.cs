using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class WholeReceiptExcessRegressionTests
{
    [CompactPostgresFact]
    public async Task FullyExcessReceiptRequiresOwnerConfirmationAndActualRefundWithoutFakeAllocation()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).WholeReceiptExcessIsReturnedWithoutZeroAllocationOrTenantCredit(); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task ClosedHoldingAccidentalReceiptRefundsWithoutProvisioningAnAccount()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ClosedHoldingExcessCanReturnToVerifiedResidentWithoutAnAccount(); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task PaidSettlementKeepsItsAccidentalReceiptRefundVisibleAfterRoomRelease()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).SettlementWholeExcessIsDiscoverableAfterPhysicalRelease(); }
        finally { await fixture.DisposeAsync(); }
    }
}
