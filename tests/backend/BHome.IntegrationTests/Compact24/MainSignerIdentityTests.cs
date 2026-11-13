using BHome.IntegrationTests.Contracts;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "Docker")]
public sealed class MainSignerIdentityTests(PropertyContractDockerFixture fixture) : IClassFixture<PropertyContractDockerFixture>
{
    [Fact]
    public Task VerifiedUnlinkedResidentRejectsUnrelatedAccountAndReleasesForInternalAcceptance() =>
        new MainDraftApiTests(fixture.Contracts).ReleaseCannotAssignAnUnrelatedAccountToAnUnlinkedVerifiedResident(true);

    [Fact]
    public Task VerifiedLinkedResidentUsesOnlyTheLinkedAccount() =>
        new MainDraftApiTests(fixture.Contracts).ReviewedMainDraftReleasesOnceAndBothPartiesUseTheSamePdfThroughSimulatedActivation();
}
