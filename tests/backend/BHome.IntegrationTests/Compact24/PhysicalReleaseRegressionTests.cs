using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

public sealed class PhysicalReleaseRegressionTests
{
    private static async Task Run(Func<PaymentLedgerTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await scenario(new PaymentLedgerTests(fixture.Capture)); } finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task UnpaidRelease() => Run(t => t.PhysicalHandoverPreservesUnpaidRoomDebtAndHistoricalAccessAndClosesOnlyDepartingResidents(false));
    [CompactPostgresFact] public Task OtherOccupancyRemains() => Run(t => t.PhysicalHandoverPreservesUnpaidRoomDebtAndHistoricalAccessAndClosesOnlyDepartingResidents(true));
    [CompactPostgresFact] public Task PendingAdjustment() => Run(t => t.NewAdjustmentAfterSettlementReviewPreservesDebtButDoesNotPreventPhysicalRelease());
    [CompactPostgresFact] public Task ReviewedSettlement() => Run(t => t.RealLedgerRequiresReviewedSnapshotAndClosesOnlyDepartingContract(false));
}
