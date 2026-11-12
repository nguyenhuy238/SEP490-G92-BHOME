using BHome.Application.Storage;
using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24DepositRecoveryTests
{
    private sealed class InterruptedStorage : IObjectStorage
    {
        private readonly Compact24WorkflowFixture.TestObjectStorage inner = new();
        private int puts;
        public async Task PutAsync(string key, Stream data, long length, string type, CancellationToken token)
        {
            await inner.PutAsync(key, data, length, type, token);
            // Fail only the refund execution under test. Preparation now also
            // uploads authentic synthetic meter photos for physical handover.
            if (key.StartsWith("refunds/", StringComparison.Ordinal) && Interlocked.Increment(ref puts) == 1)
                throw new IOException("Synthetic connection lost after durable Put");
        }
        public Task CopyToAsync(string key, Stream target, CancellationToken token) => inner.CopyToAsync(key, target, token);
        public Task DeleteAsync(string key, CancellationToken token) => inner.DeleteAsync(key, token);
    }
    [CompactPostgresFact]
    public async Task DepositExecutionRecoversDurableIntentWithoutReleasingRoomOrDoubleRefunding()
    {
        var fixture = new Compact24WorkflowFixture(new InterruptedStorage()); await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).UndisputedDepositIsReservedManuallyReturnedAndRecheckedBeforeContractClosure(true); }
        finally { await fixture.DisposeAsync(); }
    }
}
