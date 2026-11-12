using BHome.IntegrationTests.PaymentsDebt;
namespace BHome.IntegrationTests.Compact24;
public sealed class DepositReceiptRegressionTests
{
    private static async Task Run(bool holding, bool external)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).DepositReceiptPreservesPartialFundsAndReturnsExcessToActualPayer(holding, external); }
        finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task MainReceiptReturnsExcessToPreAccountResident() => Run(false, false);
    [CompactPostgresFact] public Task HoldingReceiptReturnsExcessToPreAccountResident() => Run(true, false);
    [CompactPostgresFact] public Task MainReceiptReturnsExcessToExternalPayer() => Run(false, true);
    [CompactPostgresFact] public Task HoldingReceiptReturnsExcessToExternalPayer() => Run(true, true);
    [CompactPostgresFact]
    public async Task CanonicalFundsRemainVisibleThroughoutTheContractLifecycle()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).CanonicalDepositIsUsedByReadinessHistoryAndSettlement(); }
        finally { await fixture.DisposeAsync(); }
    }
}
