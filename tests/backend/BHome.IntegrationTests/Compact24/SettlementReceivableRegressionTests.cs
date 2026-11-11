using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

public sealed class SettlementReceivableRegressionTests
{
    [CompactPostgresFact]
    public async Task DamageDebtAndOffsetsSurvivePhysicalRelease()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).DamageAboveDepositRemainsRoomDebtWithSeparateCanonicalOffsets(); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact]
    public async Task DamageEvidenceAndInvoiceOffsetsAreValidated()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).DepositOffsetsVerifyDamageEvidenceAndFinalInvoiceBalance(); }
        finally { await fixture.DisposeAsync(); }
    }
}
