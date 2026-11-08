using BHome.IntegrationTests.Compact24;

namespace BHome.IntegrationTests.Ocr;

// Reuse business assertions with real PostgreSQL and explicit storage substitute.
// This suite does not establish real camera, model accuracy or MinIO behavior.
[Trait("Category", "CompactPostgres")]
public sealed class CompactMeterOcrWorkflowTests
{
    private static async Task Run(Func<CaptureWorkflowTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await scenario(new CaptureWorkflowTests(fixture.Capture)); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact] public Task ServerProfilesAndLocationScope() => Run(t => t.MeterOcrUsesPersistedProfilesAndRejectsOtherLocationsBeforeInference());
    [CompactPostgresFact] public Task ProposalIsNotConfirmed() => Run(t => t.OcrPersistsOnlyTheProposalUsingDatabaseDisplayPrecision());
    [CompactPostgresFact] public Task MonotonicityRequiresReview() => Run(t => t.OcrWarnsAgainstTheSameMetersConfirmedBaselineWithoutCompletingTheTask());
    [CompactPostgresFact] public Task ConfirmationEvidenceAndReplay() => Run(t => t.ConfirmMeterWorkflowAsync(verifyMinioObject: false));
    [LocalMeterPostgresFact] public Task RealModelsProposalCorrectionAndEvidence() => Run(t => t.RealMeterModelsPersistProposalThenStaffCorrectionAndEvidence());
    [LocalMeterPostgresFact] public Task AssignedExperimentalModelsRemainReadOnly() => Run(t => t.AssignedExperimentalModelsUseDatabaseProfileWithoutWritingProposals());
}

public sealed class LocalMeterPostgresFactAttribute : FactAttribute
{
    public LocalMeterPostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")) ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")))
            Skip = "Requires disposable loopback PostgreSQL and pinned public local OCR models.";
    }
}
