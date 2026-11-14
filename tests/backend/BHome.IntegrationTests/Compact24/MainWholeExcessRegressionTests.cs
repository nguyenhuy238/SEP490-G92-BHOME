using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class MainWholeExcessRegressionTests
{
    private static async Task Run(bool external)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).MainWholeExcessRemainsRefundableAfterPhysicalRelease(external); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task MainDepositWholeExcessReturnsToResidentAfterRelease() => Run(false);
    [CompactPostgresFact] public Task MainDepositWholeExcessReturnsToExternalPayerAfterRelease() => Run(true);
    [CompactPostgresFact]
    public async Task CancelledMainCanReturnAnAccidentalReceiptBeforeAnyAccountExists()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ClosedDepositExcessCanReturnToVerifiedResidentWithoutAnAccount(true); }
        finally { await fixture.DisposeAsync(); }
    }
}
