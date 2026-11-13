using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Application.PropertyManagement;

namespace BHome.Application.Contracts;

public sealed record ContractDraftInput(Guid RoomId, Guid OwnerSignerId, Guid? TenantUserId,
    Guid RepresentativeResidentId, [Required, MinLength(1), MaxLength(50)] Guid[] ResidentIds,
    DateOnly StartDate, DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit,
    [Required, StringLength(12000, MinimumLength = 1)] string Terms, Guid? HoldingContractId = null);
public sealed record HoldingDraftInput(Guid RoomId, Guid OwnerSignerId, Guid? TenantUserId,
    Guid RepresentativeResidentId, [Required, MinLength(1), MaxLength(50)] Guid[] ResidentIds,
    DateOnly StartDate, DateOnly EndDate, DateTimeOffset ExpiresAt,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal HoldingDeposit,
    [Required, StringLength(12000, MinimumLength = 1)] string Terms, short? ReservedCapacity = null, int? SettingsVersion = null);
public sealed record HoldingDecisionInput([Required, StringLength(2000, MinimumLength = 1)] string Reason);
public sealed record HoldingConversionInput(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredSecurityDeposit);
public sealed record HoldingPriceCharge(Guid PolicyId, string ChargeCode, int Category, int Method,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Rate,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo, int Version);
public sealed record HoldingPriceSnapshot(
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal AgreedRent,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal HoldingDeposit,
    DateOnly TenancyFrom, DateOnly TenancyTo, DateTimeOffset HoldingExpiresAt, string Trigger, DateTimeOffset LockedAt,
    IReadOnlyList<HoldingPriceCharge> Charges);
public sealed record HoldingDepositStatus(Guid ContractId, string Status,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Required,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Verified,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Remaining,
    bool RequiresManualReview, DateTimeOffset? PriceLockedAt, string? PriceLockTrigger, HoldingDispositionView? Disposition = null);
public sealed record RenewalInput(DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [Required, StringLength(12000, MinimumLength = 1)] string Terms);
public sealed record ContractId(Guid Id);
public sealed record ContractVersionView(Guid Id, Guid? PreviousContractId, string Kind, string Status, DateOnly StartDate, DateOnly EndDate,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? MonthlyRent, string Terms);
public sealed record ContractSummary(Guid Id, Guid RoomId, Guid LocationId, string LocationName, string RoomNumber,
    string Kind, string Status, DateOnly StartDate, DateOnly EndDate,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal MonthlyRent, bool OnboardingDraft = false,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal RequiredDeposit = 0,
    DateTimeOffset? HoldingExpiresAt = null);
public sealed record ContractPage(IReadOnlyList<ContractSummary> Items, int Page, int PageSize, int TotalCount);
public sealed record ContractListScope(Guid ActorId, bool Owner, bool Staff, bool Tenant, DateOnly Today);
// Placement null puts the signature in the signer's own box of the contract's signature block. UsePicture null/true
// shows the signer's saved signature picture (when there is one) above "Ký bởi / Ngày ký"; false shows the text only.
public sealed record SigningInput(Guid CertificateId, SignaturePlacementInput? Placement = null, bool? UsePicture = null);
// Page is 1-based; X, Y and Width are fractions of the page measured from its top-left corner.
public sealed record SignaturePlacementInput(int Page, double X, double Y, double Width)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsValid => Page is >= 1 and <= 500 && X is >= 0 and < 1 && Y is >= 0 and < 1 && Width is >= 0.08 and <= 0.6 && X + Width <= 1.0001;
}
public sealed record SigningAppearance(SignaturePlacementInput? Placement, bool UsePicture);
// What a signer sees before choosing where to sign: the pages of the PDF they will sign, and their suggested box.
public sealed record SigningPageSize(double Width, double Height);
public sealed record SigningLayout(int PageCount, IReadOnlyList<SigningPageSize> Pages, SignaturePlacementInput? Suggested,
    string Party, bool HasPicture, string SignerName);
public interface IContractSigningPages
{
    SigningLayoutInfo Inspect(byte[] pdf, bool owner);
    byte[] RenderPage(byte[] pdf, int page, int maxWidth);
}
public sealed record SigningLayoutInfo(IReadOnlyList<SigningPageSize> Pages, SignaturePlacementInput? Suggested);
public sealed record DepositInput([Required, StringLength(150, MinimumLength = 1)] string BankTransactionReference,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount, [Required, StringLength(2000, MinimumLength = 1)] string VerificationReason);
public sealed record TerminationInput(DateOnly ProposedDate,
    [Required, StringLength(2000, MinimumLength = 1)] string Reason);
public sealed record InspectionScheduleInput(DateTimeOffset ScheduledAt, Guid? StaffUserId = null, int? ExpectedVersion = null);
public sealed record InspectionInput(Guid ElectricityReadingId, Guid WaterReadingId,
    [Required, StringLength(4000, MinimumLength = 1)] string Notes,
    [Required, MinLength(1), MaxLength(5)] Guid[] EvidenceIds,
    HandoverAssetInput[]? Assets = null, string? RoomCondition = null, string? KeysAndAccess = null, int? ExpectedVersion = null);
public sealed record InspectionReviewInput(int Version, bool Confirmed, string Reason, bool NoAdditionalCharges = false);
public sealed record FinalInspectionView(Guid Id, int Version, Guid BaselineContractId, int BaselineVersion, HandoverSnapshot Baseline,
    HandoverSnapshot Observed, Guid StaffId, DateTimeOffset InspectedAt, string? OwnerDecision, string? OwnerReason, DateTimeOffset? ReviewedAt);
public sealed record InspectionPreparation(HandoverView? Baseline, Guid? BaselineContractId, IReadOnlyList<HandoverReading> FinalReadings, bool OtherTenantsRemain);
public sealed record SettlementInput([Required, StringLength(2000, MinimumLength = 1)] string Decision, string? ExpectedReference = null);
public sealed record CompletionInput(DateOnly ActualEndDate);
public sealed record SigningRecoveryInput([Required, StringLength(200, MinimumLength = 1)] string ProviderReference);
public sealed record SignatureView(Guid Id, Guid SignerUserId, string Status, DateTimeOffset? SignedAt);
public sealed record ContractOccupantView(Guid Id, string Label, bool Representative);
public sealed record ContractView(Guid Id, Guid RoomId, string Kind, string Status, DateOnly StartDate, DateOnly EndDate,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit, string Terms, Guid? PreviousContractId,
    IReadOnlyList<Guid> ResidentIds, IReadOnlyList<SignatureView> Signatures, DateTimeOffset? ActivatedAt,
    Guid OwnerSignerId, Guid? TenantUserId, Guid RepresentativeResidentId, Guid? HoldingContractId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AppliedHoldingDeposit,
    Guid LocationId = default, bool IsDevelopmentDemo = false, string RoomNumber = "", string LocationName = "", IReadOnlyList<ContractOccupantView>? Occupants = null, DateOnly? ActualEndDate = null, bool OnboardingDraft = false,
    DateTimeOffset? HoldingExpiresAt = null, short? ReservedCapacity = null, DateTimeOffset? ApprovedAt = null,
    DateTimeOffset? PriceLockedAt = null, string? PriceLockTrigger = null, Guid? ConvertedMainContractId = null,
    string SigningMode = "", string SnapshotHash = "");
public sealed record ActivationReadiness(bool Ready, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal VerifiedDeposit, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RemainingDeposit,
    IReadOnlyList<string> Blockers);
public interface IAdministrativeContractReadiness
{
    Task<IReadOnlyList<string>> BlockersAsync(Guid contractId, Guid roomId, CancellationToken token);
}
public sealed record MoveOutView(Guid Id, string Status, DateOnly ProposedDate, string Reason,
    DateTimeOffset? InspectionScheduledAt, string PendingReason, string? InspectionNotes = null,
    DateTimeOffset? InspectedAt = null, Guid? ElectricityReadingId = null, Guid? WaterReadingId = null,
    IReadOnlyList<Guid>? EvidenceIds = null, Guid? InspectionStaffId = null, int Version = 1,
    bool OwnerConfirmedInspection = false, string FinancialReviewStatus = "PendingReview");
public sealed record MoveOutHistoryView(int Version, string Action, Guid ActorId, DateTimeOffset OccurredAt, string Snapshot);
public sealed record MoveOutAssignment(Guid ContractId, Guid RoomId, string RoomNumber, string LocationName, string Status, DateOnly ProposedDate, DateTimeOffset ScheduledAt, int Version);
public sealed record SettlementReviewView(Guid Id, string Decision, bool Settled, Guid ReviewedByUserId, DateTimeOffset ReviewedAt, string FinancialSnapshot = "{}");

public sealed class ContractException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static ContractException Missing() => new(404, "contract_resource_not_found");
    public static ContractException Conflict(string code) => new(409, code);
    public static ContractException Invalid(string code) => new(400, code);
}

// All PDF input comes from the immutable server snapshot. No uploaded arbitrary PDF can replace signed terms.
public sealed record ContractDocument(Guid ContractId, Guid RoomId, Guid OwnerSignerId, Guid TenantUserId,
    Guid RepresentativeResidentId, Guid[] ResidentIds, DateOnly StartDate, DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit, Guid? HoldingContractId, decimal AppliedHoldingDeposit, string Terms, string SnapshotHash)
{
    // Server-derived rendering context; excluded from the persisted historical document/hash format.
    [JsonIgnore] public bool IsOperatingPolicyAmendment { get; init; }
    [JsonIgnore] public bool IsInternalResidentAcceptance { get; init; }
}
public sealed record SigningPreparation(byte[] SourcePdf, byte[] PreparedPdf, string FieldName, string DocumentDigest,
    string DataToSignDigest, string CertificateChain, string ProviderUserId, string CredentialId);
public sealed record SigningOutcome(string State, byte[]? SignedPdf = null);
public interface IContractSigningProvider
{
    // Signs in the signer's box of the signature block with their picture when they have one.
    Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t);
    // A placement or picture choice made on the signing screen. Providers that draw nothing may ignore it.
    Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t) => PrepareAsync(document, certificateId, previousPdf, t);
    // Signer display data for the layout screen: whether a picture is saved, and the name the box will show.
    Task<(bool HasPicture, string SignerName)> SignerAsync(CancellationToken t) => Task.FromResult((false, ""));
    Task<string> RequestAsync(ContractSignature signature, CancellationToken t);
    Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t);
}
public interface IContractDocumentRenderer
{
    Task<ContractTemplateView> ConfigurationAsync(CancellationToken t);
    // Check snapshot integrity and template eligibility even when reusing the first signer's PDF.
    Task ValidateAsync(ContractDocument document, CancellationToken t);
    Task<byte[]> RenderAsync(ContractDocument document, CancellationToken t);
}
public interface IContractFileStore
{
    Task PutAsync(Guid roomId, string key, byte[] bytes, string contentType, CancellationToken t);
}
public interface IContractImageValidator { string Validate(byte[] content); }

// Implemented by the invoice/payment/deposit module. A caller's confirmation or screenshot cannot satisfy this gate.
public sealed record SettlementLedgerState(bool AllObligationsResolved, bool DepositResolved,
    bool TransfersVerified, string DecisionReference);
public interface IContractSettlementLedger
{
    Task<SettlementLedgerState?> ReadAsync(Guid contractId, Guid electricityReadingId, Guid waterReadingId, CancellationToken t);
}
public sealed record SettlementInvoice(Guid InvoiceId, DateOnly BillingPeriod, bool Shared, BHome.Application.Billing.InvoiceFinancialView Financials);
public sealed record ContractSettlementSummary(Guid ContractId, Guid DepositContractId, Guid RoomId, string RoomNumber, Guid TenantUserId,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal VerifiedSecurityDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal AppliedHoldingDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ContractSpecificOutstanding,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ApprovedFinalCharges,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ApprovedDeductions,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? RefundAmount,
    IReadOnlyList<SettlementInvoice> Invoices, IReadOnlyList<string> UnresolvedItems, bool OtherActiveContracts, bool Resolved, string Reference,
    string TransferVerificationStatus = "PendingReview", SettlementCalculation? Calculation = null, string FinancialReference = "",
    DepositDeductionPlan? DepositDeductions = null, string ObligationReference = "",
    IReadOnlyList<SettlementReceivableBalance>? Receivables = null, SettlementChargeReview? ChargeReview = null,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal ApprovedDepositOffsets = 0);
public interface IContractSettlementDetails
{
    Task<ContractSettlementSummary> SummaryAsync(Guid contractId, CancellationToken t);
}

public sealed record HoldingDepositApplication(Guid HoldingContractId, Guid RoomId, Guid? TenantUserId,
    decimal AppliedAmount, string AllocationReference);
// The BF-03A adapter MUST validate signed/active/unexpired Holding + verified funds, then durably
// allocate/convert in the SAME DbContext transaction as the Main Contract. No remote financial mutation here.
public interface IContractHoldingLedger
{
    Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId,
        Guid? tenantUserId, decimal requiredDeposit, CancellationToken t);
}

public interface IContractRepository
{
    Task<ContractPage> ListAsync(ContractListScope scope, int page, int pageSize, Guid? locationId, ContractStatus? status, CancellationToken t);
    Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t);
    Task FlushAsync(CancellationToken t);
    Task<Contract?> FindAsync(Guid id, CancellationToken t);
    Task<Room?> RoomAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t);
    Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t);
    Task<bool> StaffAssignedAsync(Guid staffId, Guid locationId, DateOnly today, CancellationToken t);
    Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, Guid[] residentIds, CancellationToken t);
    Task<bool> HasOtherActiveContractsAsync(Guid roomId, Guid exceptId, CancellationToken t);
    Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<Contract>> VersionsAsync(Guid roomId, Guid tenantId, CancellationToken t);
    Task<IReadOnlyList<ContractMoveOutHistory>> MoveOutHistoryAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<ContractFinalInspection>> FinalInspectionsAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<HandoverReading>> FinalReadingsAsync(Guid contractId, Guid roomId, DateOnly today, CancellationToken t);
    Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(Guid staffId, DateOnly today, CancellationToken t);
    Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t);
    Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t);
    Task<ResolvedPrices> ResolvePricesAsync(Guid roomId, DateOnly effectiveOn, CancellationToken t);
    Task<bool> HoldingConflictAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t);
    Task<Contract?> MainForHoldingAsync(Guid holdingId, CancellationToken t);
    Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t);
    Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly on, CancellationToken t);
    Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t);
    void Add(object entity);
    void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at);
    void AuditAnonymous(string action, Guid targetId, DateTimeOffset at);
    Task CloseResidenceAsync(Contract contract, DateOnly actualEndDate, Guid actorId, DateTimeOffset at, CancellationToken t);
    Task<IReadOnlyList<ContractOccupantView>> OccupantsAsync(Guid contractId, CancellationToken t);
}
