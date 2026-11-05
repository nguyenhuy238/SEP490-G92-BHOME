using System.Collections.Concurrent;
using System.Security.Cryptography;
using BHome.Application.Storage;
using BHome.IntegrationTests.Billing;
using BHome.IntegrationTests.Contracts;
using BHome.IntegrationTests.Ocr;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

// Reuse the existing regression scenarios and assertions against a different persistence composition.
// Storage is an explicit test substitute. Real MinIO remains a separate integration gate.
public sealed class Compact24WorkflowFixture : IAsyncLifetime
{
    internal static ConcurrentQueue<string> Diagnostics { get; } = new();
    private readonly Compact24Fixture database = new();
    private WebApplicationFactory<Program>? host;
    internal CaptureFixture Capture { get; private set; } = null!;
    internal string Connection => database.Connection;
    public async Task InitializeAsync()
    {
        await database.InitializeAsync(); if (database.Factory is null) return;
        var storage = new TestObjectStorage();
        var encryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var hmacKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        host = database.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["IdentityProtection:ActiveEncryptionVersion"] = "test",
                ["IdentityProtection:ActiveHmacVersion"] = "test",
                ["IdentityProtection:EncryptionKeys:test"] = encryptionKey,
                ["IdentityProtection:HmacKeys:test"] = hmacKey
            }));
            b.ConfigureServices(s =>
            {
                s.AddSingleton<IObjectStorage>(storage);
                s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, TestFailureDiagnostic>());
            });
        });
        Capture = new CaptureFixture(host, "http://private-storage-test.invalid");
    }
    public async Task DisposeAsync() { if (host is not null) await host.DisposeAsync(); await database.DisposeAsync(); }

    private sealed class TestFailureDiagnostic : Microsoft.AspNetCore.Diagnostics.IExceptionHandler
    {
        public ValueTask<bool> TryHandleAsync(Microsoft.AspNetCore.Http.HttpContext context, Exception exception, CancellationToken token)
        {
            if (exception is not (BHome.Application.Billing.InvoiceException or BHome.Application.Billing.AdjustmentException or
                BHome.Application.PaymentsDebt.PaymentException or BHome.Application.Contracts.ContractException or
                BHome.Application.Common.IntegrationUnavailableException or BHome.Application.Ocr.OcrInputException))
                Diagnostics.Enqueue(exception.ToString());
            return ValueTask.FromResult(false);
        }
    }

    internal sealed class TestObjectStorage : IObjectStorage
    {
        private readonly ConcurrentDictionary<string, byte[]> files = new(StringComparer.Ordinal);
        public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken token)
        { using var data = new MemoryStream(); await content.CopyToAsync(data, token); files[key] = data.ToArray(); }
        public async Task CopyToAsync(string key, Stream destination, CancellationToken token)
        { if (!files.TryGetValue(key, out var data)) throw new FileNotFoundException("Synthetic private object missing."); await destination.WriteAsync(data, token); }
        public Task DeleteAsync(string key, CancellationToken token) { token.ThrowIfCancellationRequested(); files.TryRemove(key, out _); return Task.CompletedTask; }
    }
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24InvoiceRegressionTests
{
    private static async Task Run(Func<InvoiceApiTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await scenario(new InvoiceApiTests(fixture.Capture)); } finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task SharedRoomDraft() => Run(t => t.SharedRoomDraftIsPersistedIdempotentScopedAndExplicitlyMissingReadings());
    [CompactPostgresFact] public Task Finalization() => Run(t => t.FinalizationRequiresReviewedConfirmedDataIsConcurrentSafeImmutableAndHistoricallyScoped());
    [CompactPostgresFact] public Task Schedule() => Run(t => t.ScheduleRequiresOwnerAndValidDatesAndStaleVersionsConflict());
    [CompactPostgresFact] public Task DraftAdjustment() => Run(t => t.ApprovedDraftCorrectionSurvivesRefreshAndFinalizationWithOriginalSourceTrace());
    [CompactPostgresFact] public Task ChangedSource() => Run(t => t.SourceChangeMakesDraftCorrectionExplicitlyPendingAndPreventsFinalization());
    [CompactPostgresFact] public Task DecisionRace() => Run(t => t.OwnerApproveRejectRacePersistsExactlyOneDecisionAndOneResult());
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24PaymentRegressionTests
{
    [CompactPostgresFact] public Task RecipientInbox() => Run(t => t.InboxIsRecipientScopedPaginatedAndReadStatePersistsWithoutCrossTenantMutation());
    [CompactPostgresFact] public Task RevalidateTarget() => Run(t => t.NotificationTargetRechecksInvoiceEntitlementInsteadOfTrustingSavedLink());
    [CompactPostgresFact] public Task StaffReadMirror() => Run(t => t.StaffInboxMirrorsTaskReadStateAndLosesAccessWhenAssignmentEnds());
    [CompactPostgresFact] public Task ExpiryAndMeterNotices() => Run(t => t.ExistingContractExpiryAndMeterTaskSourcesPublishThroughOneInbox());
    private static async Task Run(Func<PaymentLedgerTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await scenario(new PaymentLedgerTests(fixture.Capture)); } finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task DeliveryRetry() => Run(t => t.DeliveryRetriesUseOneStableKeyAndPreservePaidLedgerAndInAppReadState());
    [CompactPostgresFact] public Task DeliveryFailure() => Run(t => t.DeliveryFailureStopsAtConfiguredLimitAndUnsupportedAmbiguityRequiresReview());
    [CompactPostgresFact] public Task DeliveryLease() => Run(t => t.ExpiredDeliveryLeaseDoesNotResendWithoutProviderIdempotencyAndUnconfiguredNeverReportsSuccess());
    [CompactPostgresFact] public Task NotificationEvents() => Run(t => t.InvoicePaymentAndAdjustmentEventsReachEntitledRecipientsWithoutPrivateDataOrReplayDuplicates());
    [CompactPostgresFact] public Task NoUnallocatedNotice() => Run(t => t.UnallocatedTransferDoesNotCreatePaymentConfirmedNotification());
    [CompactPostgresFact] public Task AutomationConfig() => Run(t => t.AutomationPreviewAndHistoryRemainOwnerOnlyAndReflectSelectedPeriod());
    [CompactPostgresFact] public Task MeterAutomation() => Run(t => t.MeterJobAndManualRequestsShareRoomTypePeriodKeyAndHumanConfirmation());
    [CompactPostgresFact] public Task UnassignedMeter() => Run(t => t.MeterJobPreservesUnassignedWorkAndReportsMissingMetersUntilOwnerAssigns());
    [CompactPostgresFact] public Task ReplacedMeter() => Run(t => t.MeterReplacementDoesNotDuplicatePeriodTasksAndFutureScheduleDoesNotRunEarly());
    [CompactPostgresFact] public Task DraftAutomation() => Run(t => t.DraftJobRequiresSharedRepresentativeAndPreservesApprovedCorrectionOnReplay());
    [CompactPostgresFact] public Task FinalAutomation() => Run(t => t.ManualAndScheduledFinalizationCommitOneImmutableInvoiceAndIssuanceEvent());
    [CompactPostgresFact] public Task PendingFinal() => Run(t => t.AutomaticFinalizationRequiresAuthorizationAndMissingDataRemainsDraftWithoutRepeatedChanges());
    [CompactPostgresFact] public Task FinalCorrection() => Run(t => t.PendingAdjustmentBlocksAutomationAndApprovedCorrectionIsRevalidatedBeforeFinal());
    [CompactPostgresFact] public Task LateReadings() => Run(t => t.LateConfirmedReadingsMakePendingDraftEligibleWithoutEstimatedUsage());
    [CompactPostgresFact] public Task ReconciliationApi() => Run(t => t.OwnerApiReconcilesPersistedInvoiceAndRejectsUnmatchedTransferWithHistory());
    [CompactPostgresFact] public Task PayerPrivacy() => Run(t => t.SharedTenantStatusAndHistoricalAccessStayScopedWithoutLeakingStatementOrAnotherPayerIdentity());
    [CompactPostgresFact] public Task CompetingPayments() => Run(t => t.ConcurrentTenantsCannotDoubleSettleAndSecondTransferIsPreservedForReview());
    [CompactPostgresFact] public Task Underpayment() => Run(t => t.OwnerConfirmedAmountPolicyPreservesPartialDebtAndUnallocatedExcess(99999, "verified_partial_payment"));
    [CompactPostgresFact] public Task Overpayment() => Run(t => t.OwnerConfirmedAmountPolicyPreservesPartialDebtAndUnallocatedExcess(100001, "verified_excess_payment_pending_review"));
    [CompactPostgresFact] public Task InvalidAndUnauthorized() => Run(t => t.UnauthorizedAndInvalidOrConflictingInputsCannotCreatePaidState());
    [CompactPostgresFact] public Task AdjustmentSubmission() => Run(t => t.AdjustmentSubmissionIsPersistedIdempotentAndPrivateToRequesterAndOwner());
    [CompactPostgresFact] public Task PrivateEvidence() => Run(t => t.AdjustmentEvidenceIsValidatedPrivateAndCannotBeReusedOrStolen());
    [CompactPostgresFact] public Task OrphanEvidence() => Run(t => t.FailedEvidenceUploadLeavesOnlyRecoverableIntentAndCannotBeSubmitted());
    [CompactPostgresFact] public Task PaymentAdjustmentRace() => Run(t => t.ConcurrentPaymentAndAdjustmentUseOneFinancialBasisWithoutLosingIncomingMoney());
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24TaskRegressionTests
{
    private static async Task Run(Func<BHome.IntegrationTests.StaffOperations.OperationalTaskApiTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try { await scenario(new BHome.IntegrationTests.StaffOperations.OperationalTaskApiTests(fixture.Capture)); } finally { await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task FullWorkflow() => Run(t => t.CompleteWorkflowPersistsPrivateEvidenceNotificationsReworkAndOwnerVerification());
    [CompactPostgresFact] public Task Races() => Run(t => t.DuplicateCreatesAndCompetingUpdatesAreTransactionalAndVersioned());
    [CompactPostgresFact] public Task ScopeSuccessor() => Run(t => t.ScopeIsRecheckedWithOldTokensAndSuccessorContinuesLocationWork());
    [CompactPostgresFact] public Task UploadFailure() => Run(t => t.InvalidInputMissingStaffAndFailedUploadLeaveNoBusinessRowsAndCleanupIsDurable());
    [CompactPostgresFact] public Task OwnerRace() => Run(t => t.OverduePendingReviewPreservesStateAndCompetingOwnerDecisionsHaveOneWinner());
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24PropertyRegressionTests
{
    private static async Task Run(Func<BHome.IntegrationTests.PropertyManagement.PropertyApiTests, Task> scenario)
    {
        var database = new Compact24WorkflowFixture(); await database.InitializeAsync();
        var fixture = new AuthenticationDatabaseFixture(new ApiFactory { ConnectionString = database.Connection, UseCompact24 = true });
        try { await scenario(new BHome.IntegrationTests.PropertyManagement.PropertyApiTests(fixture)); }
        finally { await fixture.DisposeAsync(); await database.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task ScopedStaff() => Run(t => t.StaffReadsOnlyCurrentAssignmentsBeforeCountingAndCannotMutate());
    [CompactPostgresFact] public Task InvalidScopes() => Run(t => t.InvalidScopesReservedStatesAndDeactivationAreRejected());
    [CompactPostgresFact] public Task DuplicateRaces() => Run(t => t.DuplicateRoomAndPolicyRacesHaveOneWinnerAndNoOrphanAudit());
    [CompactPostgresFact] public Task PricePrecedence() => Run(t => t.PriceResolutionUsesPerChargeSpecificityAndPreservesMissingAndZero());
    [CompactPostgresFact] public Task PolicyReplacement() => Run(t => t.ReplacementSplitsInclusiveDatesAndFailedReplacementRollsBackOldVersion());
    [CompactPostgresFact] public Task InvalidPrices() => Run(t => t.NegativeAmountsUnsupportedMethodsRetroactiveDatesAndInvalidPagingAreRejected());
    [CompactPostgresFact] public Task NormalizedCodes() => Run(t => t.NormalizedTypeAndAssetCodesAreUniqueWithinLocationAndOwnerAccessIsGlobal());
    [CompactPostgresFact] public Task OccupiedRoom() => Run(t => t.ExistingResidentsBlockClosureAndCaptureCannotBypassUnavailableRoom());
    [CompactPostgresFact] public Task CrossLocationReferences() => Run(t => t.ParallelEditsUseExpectedVersionAndDatabaseEnforcesCrossLocationReferences());
    [CompactPostgresFact] public Task FuturePriceEdit() => Run(t => t.OwnerEditsUnusedFuturePriceInPlaceWithVersionAndAudit());
    [CompactPostgresFact] public Task FutureValidation() => Run(t => t.FutureEditsValidateDatesAmountAndImmutableScope());
    [CompactPostgresFact] public Task FutureEditRace() => Run(t => t.ParallelFutureEditsHaveOneWinnerAndOverlappingEditRollsBackAudit());
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24ContractRegressionTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    private async Task Run(Func<ContractLifecycleApiTests, Task> scenario)
    {
        await using var contract = new ContractFixture(fixture.Capture);
        await contract.InitializeAsync();
        await scenario(new ContractLifecycleApiTests(contract));
    }
    [CompactPostgresFact] public Task SigningActivationAndReplay() => Run(t => t.T01_T07_RealPersistenceTwoPartySignaturesActivationAndParallelReplay());
    [CompactPostgresFact] public Task RejectInvalidActivation() => Run(t => t.T02_T03_T04_T16_UnsignedUnderpaidAndWrongActorAreRejected());
    [CompactPostgresFact] public Task CompetingActivation() => Run(t => t.T05_CompetingActivationsHaveOneWinnerAndNoPartialRoomState());
    [CompactPostgresFact] public Task DuplicateDeposit() => Run(t => t.BankReferenceCannotBeAllocatedToTwoContractsEvenInParallel());
    [CompactPostgresFact] public Task Renewal() => Run(t => t.T08_T09_RenewalPreservesSignedVersionRejectsDuplicateAndWaitsForEffectiveDate());
    [CompactPostgresFact] public Task MoveOut() => Run(t => t.T10_T11_T12_T13_T14_InspectionFinalMetersPendingSettlementAndCompletedMoveOut());
    [CompactPostgresFact] public Task Handover() => Run(t => t.MoveInHandoverRequiresScopedStaffRealReadingsEvidenceAndSameVersionConfirmations());
    [CompactPostgresFact] public Task Scope() => Run(t => t.ListScopesBeforeCountingAndPagingAndReturnsOnlySafeSummaries());
    [CompactPostgresFact] public Task ScopeRevocation() => Run(t => t.ListRechecksEffectiveAssignmentsWithSameToken());
    [CompactPostgresFact] public Task ProviderFailure() => Run(t => t.T15_UnconfiguredRealProviderKeepsDurablePendingAndCannotActivate());
    [CompactPostgresFact] public Task Expiry() => Run(t => t.ExpiryAndRenewalCancellationPreserveCurrentContractAndOccupancy());
    [CompactPostgresFact] public Task Idempotency() => Run(t => t.InvalidInputAndChangedIdempotencyPayloadReturn400And409());
    [CompactPostgresFact] public Task HoldingTransfer() => Run(t => t.HoldingAllocationIsPersistedOnceAndCannotFundTwoMainContracts());
    [CompactPostgresFact] public Task AmbiguousProvider() => Run(t => t.AmbiguousSigningRequestIsNotResentAndRecoveryDoesNotMeanSigned());
    [CompactPostgresFact] public Task FailedSigningRetry() => Run(t => t.FailedSignatureCanBeRetriedWhileRetainingTheFailedAttempt());
    [CompactPostgresFact] public Task FailedUpload() => Run(t => t.UploadFailureLeavesDurableCleanupIntentAndNoDanglingSignatureReference());
    [CompactPostgresFact] public Task RemoteSigningAdapter() => Run(t => t.ProductionAdapterAndPdfSignerCompleteTwoPartyContractThroughApiWithSyntheticRemoteCa());
    [CompactPostgresFact] public Task SignedDocumentIntegrity() => Run(t => t.SignedDocumentDownloadRejectsTamperedBytesAndPreservesSignerScope());
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24MainDraftRegressionTests
{
    private static async Task Run(Func<MainDraftApiTests, Task> scenario)
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        await using var contracts = new ContractFixture(fixture.Capture); await contracts.InitializeAsync();
        try { await scenario(new MainDraftApiTests(contracts)); }
        finally { await contracts.DisposeAsync(); await fixture.DisposeAsync(); }
    }
    [CompactPostgresFact] public Task EncryptedOnboardingAndDocx() => Run(t => t.VerifiedOnboardingCreatesDraftWithoutTenantAndPersistsDocxWhenPdfConverterMissing());
    [CompactPostgresFact] public Task InvalidAndUnauthorized() => Run(t => t.RejectsDuplicateInvalidPeriodUnassignedStaffAndNonDraftEdits());
    [CompactPostgresFact] public Task EffectiveSettings() => Run(t => t.EffectiveDateUsesRevisedSettingsAndFutureRentalRateWithoutRevivingOldSettings());
    [CompactPostgresFact] public Task ConcurrentDraft() => Run(t => t.RejectsUnavailableRoomAndConcurrentCreationReplaysOneDraft());
    [CompactPostgresFact] public Task IncompleteIdentity() => Run(t => t.VerifiedFlagWithoutConfirmedIdentityDoesNotGenerateAnIncompleteContract());
    [CompactPostgresFact] public Task OccupantModels() => Run(t => t.FamilyMembersShareOneDraftButIndependentRepresentativesGetSeparateContracts());
}
