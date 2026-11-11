using BHome.Application.Contracts;
namespace BHome.IntegrationTests.Compact24;
public sealed class HoldingCancellationTests
{
    [CompactPostgresFact]
    public async Task VoluntaryCancellationForfeitsVerifiedHoldingWithoutCreatingAnAccount()
    { var fixture = new Compact24Fixture(); await fixture.InitializeAsync(); try { await new AnonymousSigningTests(fixture).AnonymousHoldingWorkflow(HoldingCancellationCause.TenantVoluntary); } finally { await fixture.DisposeAsync(); } }
    [CompactPostgresFact]
    public async Task OwnerFailureRefundsTheAnonymousDepositorOnlyAfterExternalExecutionEvidence()
    { var fixture = new Compact24Fixture(); await fixture.InitializeAsync(); try { await new AnonymousSigningTests(fixture).AnonymousHoldingWorkflow(HoldingCancellationCause.OwnerCannotProvideRoom); } finally { await fixture.DisposeAsync(); } }
}
