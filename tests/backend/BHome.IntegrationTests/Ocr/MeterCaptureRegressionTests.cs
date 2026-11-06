using BHome.IntegrationTests.Compact24;

namespace BHome.IntegrationTests.Ocr;

// Runs the capture scenarios on a disposable Compact24 PostgreSQL database.
// Storage is the existing explicit in-memory substitute; real MinIO is a separate gate.
[Trait("Category", "CompactPostgres")]
public sealed class MeterCaptureRegressionTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public Task ProposalPrecision() => new CaptureWorkflowTests(fixture.Capture).OcrPersistsOnlyTheProposalUsingDatabaseDisplayPrecision();
    [CompactPostgresFact]
    public Task PreviousReadingWarning() => new CaptureWorkflowTests(fixture.Capture).OcrWarnsAgainstTheSameMetersConfirmedBaselineWithoutCompletingTheTask();
    [CompactPostgresFact]
    public Task ConfirmationAndReplay() => new CaptureWorkflowTests(fixture.Capture).ConfirmMeterWorkflowAsync(verifyMinioObject: false);
    [CompactPostgresFact]
    public Task InvalidConfirmation() => new CaptureWorkflowTests(fixture.Capture).MissingBaselineWrongEvidenceAndUnconfirmedOrNegativeReadingCannotCompleteTask();
    [CompactPostgresFact]
    public Task StorageFailure() => new CaptureWorkflowTests(fixture.Capture).PartialStorageFailureLeavesDurableCleanupIntentAndCannotCreateConfirmedReading();
}
