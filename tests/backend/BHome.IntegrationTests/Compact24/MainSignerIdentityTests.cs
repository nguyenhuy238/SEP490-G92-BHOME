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

    [Fact]
    public Task FamilyOccupantsKeepTheirRepresentativeAndIndependentRepresentativesUseSeparateDrafts() =>
        new MainDraftApiTests(fixture.Contracts).FamilyMembersShareOneDraftButIndependentRepresentativesGetSeparateContracts();

    [Fact]
    public Task CertificateDirectoryAndRequestsCannotUseAnotherSignersCertificate() =>
        new ContractLifecycleApiTests(fixture.Contracts).CertificateDirectoryIsPrivateAndActualAdapterRejectsAnotherSignersCertificate();

    [Fact]
    public Task MissingSignaturesDepositOrAuthorizedActorCannotActivate() =>
        new ContractLifecycleApiTests(fixture.Contracts).T02_T03_T04_T16_UnsignedUnderpaidAndWrongActorAreRejected();

    [Fact]
    public Task CompetingActivationsStillEnforceRoomCapacityAtomically() =>
        new ContractLifecycleApiTests(fixture.Contracts).T05_CompetingActivationsHaveOneWinnerAndNoPartialRoomState();
}
