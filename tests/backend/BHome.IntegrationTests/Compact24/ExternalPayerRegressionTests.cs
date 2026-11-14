using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class ExternalPayerRegressionTests
{
    [CompactPostgresFact]
    public async Task ExternalPayerReceivesItsOwnPartialAndWholeExcessWithoutPlaceholderIdentity()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ExternalPayerRefundsPartialAndWholeExcessWithoutInventingAResident(); }
        finally { await fixture.DisposeAsync(); }
    }
}
