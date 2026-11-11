using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class MainDepositSafetyRegressionTests
{
    [CompactPostgresFact]
    public async Task DirectDepositPreservesTheAgreedCapUnderRacesAndReplays()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).DirectMainDepositCannotExceedAgreedFundsUnderConcurrentVerification(); }
        finally { await fixture.DisposeAsync(); }
    }
}
