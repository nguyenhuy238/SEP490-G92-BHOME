using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class IdentityRetentionRegressionTests
{
    [CompactPostgresFact]
    public async Task RetentionHoldsAndReviewsPreservePrivateIdentityAndFinancialHistory()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).IdentityRetentionMetadataIsPrivateAuditedAndCannotEraseIdentity(); }
        finally { await fixture.DisposeAsync(); }
    }
}
