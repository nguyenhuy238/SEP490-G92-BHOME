using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

// A mutable move-in preparation lives alongside, not inside, the signed Main contract.
// The Compact24 storage envelope is contracts.handover.preparation; the confirmed
// baseline remains contracts.handover.current and keeps its existing invariants.
public sealed record HandoverDraftRequest(Guid Id, int Version, string Reason, string Status,
    DateTimeOffset CreatedAt, string? DecisionReason = null, Guid? ReviewedBy = null, DateTimeOffset? ReviewedAt = null);

// Reinspection is scoped to individual observations. A Staff recheck is an
// observation, never permission to order repairs or approve their cost.
public sealed record HandoverReinspectionItem(string Kind, string? Code = null, Guid? AssetId = null,
    bool Rechecked = false, Guid? ReadingId = null);
public sealed record HandoverReinspectionRecord(int Version, string Reason, Guid OwnerId,
    DateTimeOffset RequestedAt, HandoverReinspectionItem[] Items);
public sealed record HandoverSignatureDocument(Guid Id, Guid SignerId, DateTimeOffset SignedAt,
    string ObjectKey, string FileHash, string Method);
public sealed record HandoverPendingSignature(Guid Id, Guid SignerId, string SourceHash,
    string PreparedHash, string PreparedObjectKey, string FieldName, string DocumentDigest,
    string DataToSignDigest, string CertificateChain, string ProviderUserId,
    string CredentialId, DateTimeOffset ExpiresAt);

// A fixed room checklist prevents a single free-text answer from hiding an
// uninspected wall, door, electrical outlet or safety installation.
public sealed record HandoverRoomCheck(string Code, string Status, string? Notes, Guid[] EvidenceIds);
public sealed record HandoverAccessItem(string Type, int Quantity, string Notes);
public sealed record HandoverOutstandingIssue(string Code, string Description, string ResponsibleParty,
    DateOnly? DueDate);
// Status is sourced from the existing authorized OperationalTask workflow, not
// inferred from draft contents. Start via /api/v1/operational-tasks/{id}/start.
// The legacy pre-handover inventory remains a backend checkpoint, but is surfaced
// as a subsection of the single Staff move-in job rather than a second work card.
public sealed record HandoverMoveInTask(Guid Id, string Status, int Version, bool CanInspect,
    Guid? InventoryTaskId = null, string? InventoryStatus = null);

// Factual, completed Staff inventory observations. These are not a declaration
// that the Owner accepted an exceptional asset or agreed to hand it over.
// Handed-over quantities require their own explicit approval in the draft.
public sealed record HandoverInspectedAsset(Guid Id, string Name, int ExpectedQuantity,
    int ActualQuantity, string Condition, string? Notes);

// The task's initial inventory token distinguishes an actual change of room
// assets from an obsolete draft.assets copy or draft.inventoryToken.
public sealed record HandoverCompletedInventory(string SourceToken, DateTimeOffset CompletedAt,
    HandoverInspectedAsset[] Items, IReadOnlyDictionary<Guid, DateTimeOffset?> LatestEvidenceAt);

public sealed record HandoverDraftState(
    int Version, string Status, string ContractSnapshotHash, DateTimeOffset CreatedAt,
    string RoomCondition, string KeysAndAccess, string Notes, HandoverAssetInput[] Assets,
    Guid[] EvidenceIds, string? InventoryToken, Guid? StaffPreparedBy, DateTimeOffset? StaffPreparedAt,
    Guid? OwnerReadyBy, DateTimeOffset? OwnerReadyAt, Guid? TenantConfirmedBy,
    DateTimeOffset? TenantConfirmedAt, HandoverDraftRequest[] Requests,
    Guid? ApprovedElectricityReadingId = null, Guid? ApprovedWaterReadingId = null,
    string? OwnerReadyReason = null, string? OwnerHandlingPlan = null,
    HandoverRoomCheck[]? RoomChecks = null, HandoverAccessItem[]? AccessItems = null,
    HandoverOutstandingIssue[]? OutstandingIssues = null,
    Guid[]? KeyEvidenceIds = null,
    Guid? StaffSubmittedBy = null, DateTimeOffset? StaffSubmittedAt = null,
    HandoverReinspectionItem[]? ReinspectionItems = null,
    HandoverReinspectionRecord[]? ReinspectionHistory = null,
    HandoverSignatureDocument? OwnerSignature = null,
    HandoverPendingSignature? TenantSigning = null,
    HandoverSignatureDocument? TenantSignature = null)
{
    public static HandoverDraftState Create(Contract contract, DateTimeOffset at) =>
        new(1, "Draft", contract.SnapshotHash, at, "", "", "", [], [], null,
            null, null, null, null, null, null, []);
}

public sealed record HandoverDraftView(
    int Version, string Status, Guid ContractId, string RoomNumber, string LocationName,
    string LocationAddress, DateOnly StartDate, DateOnly EndDate, decimal MonthlyRent,
    decimal RequiredDeposit, string Terms, HandoverReading? Electricity, HandoverReading? Water,
    HandoverAsset[] Assets, string RoomCondition, string KeysAndAccess, string Notes,
    Guid[] EvidenceIds, string? InventoryToken, bool NoAssetsConfirmed,
    DateTimeOffset? OwnerReadyAt, DateTimeOffset? TenantConfirmedAt,
    HandoverDraftRequest[] Requests, string[] Missing,
    HandoverRoomCheck[]? RoomChecks = null, HandoverAccessItem[]? AccessItems = null,
    HandoverOutstandingIssue[]? OutstandingIssues = null,
    HandoverMoveInTask? MoveInTask = null, bool InventoryHasIssues = false,
    Guid[]? KeyEvidenceIds = null,
    DateTimeOffset? StaffSubmittedAt = null, DateTimeOffset? OwnerSignedAt = null,
    DateTimeOffset? TenantSignedAt = null, HandoverReinspectionItem[]? ReinspectionItems = null,
    HandoverReinspectionRecord[]? ReinspectionHistory = null,
    string? OwnerDocumentHash = null, Guid? OwnerDocumentId = null,
    bool TenantSigningPending = false, string? OwnerReadyReason = null,
    string? OwnerHandlingPlan = null, Guid? StaffSubmittedBy = null,
    HandoverInspectedAsset[]? InspectedAssets = null,
    // Explicit capability negotiation. Older backend versions omit this
    // property, so clients must not sign until the backend can bind real ink.
    bool OwnerInkSigningSupported = false,
    [property: System.Text.Json.Serialization.JsonIgnore] string? OwnerName = null,
    [property: System.Text.Json.Serialization.JsonIgnore] string? TenantName = null);

// Owner inbox: one row per persisted move-in preparation, not a list of every
// contract. Detail/evidence remain available only through the existing
// contract-scoped authorized routes.
public sealed record HandoverInboxItem(Guid ContractId, Guid LocationId, string LocationName,
    string RoomNumber, string Status, DateOnly StartDate, DateTimeOffset? StaffSubmittedAt,
    DateTimeOffset? OwnerReadyAt, DateTimeOffset? TenantConfirmedAt);
public sealed record HandoverInboxPage(IReadOnlyList<HandoverInboxItem> Items, int Page,
    int PageSize, int TotalCount);

public sealed record HandoverDraftWrite(int Version, string? RoomCondition = null,
    string? KeysAndAccess = null, string? Notes = null, HandoverAssetInput[]? Assets = null,
    Guid[]? EvidenceIds = null, string? InventoryToken = null,
    HandoverRoomCheck[]? RoomChecks = null, HandoverAccessItem[]? AccessItems = null,
    // Backward-compatible wire property. Staff may clear old proposals with []
    // but cannot create a repair assignment, deadline or remediation plan.
    HandoverOutstandingIssue[]? OutstandingIssues = null,
    Guid[]? KeyEvidenceIds = null);
public sealed record HandoverDraftSubmit(int Version);
public sealed record HandoverDraftReinspection(int Version, string Reason, HandoverReinspectionItem[] Items);
// Owner's actual pen/mouse strokes for this specific Ready signature.
// Coordinates are measured on a width × height drawing pad, with each
// stroke consisting of [x, y] pairs. Never infer ink from a typed name.
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(
    System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record HandoverInkInput(int Width, int Height, double[][][]? Strokes);
public interface IHandoverSignatureInkRenderer
{
    byte[] Render(HandoverInkInput input);
}
public sealed record HandoverDraftReady(int Version, string? Reason = null, string? HandlingPlan = null,
    SigningInput? Signature = null, HandoverInkInput? Ink = null);
public sealed record HandoverDraftCorrection(int Version, string Reason);
public sealed record HandoverDraftCorrectionDecision(int Version, bool Accepted, string Reason);
public sealed record HandoverDraftTenantConfirmation(int Version, string? Note = null);
public sealed record HandoverDraftTenantSign(int Version, SigningInput Signature);
public sealed record HandoverDraftTenantSignOtp(int Version, string Code, string? Note = null);
// Explicit account-session consent + freshly drawn signature, never generated from typed text.
public sealed record HandoverDraftTenantSessionSign(int Version, bool Consent,
    HandoverInkInput? Ink, string? Note = null);

public interface IHandoverDraftRepository
{
    Task<IReadOnlyList<ContractChoice>> RoomsAsync(Guid locationId, CancellationToken token);
    Task<HandoverInboxPage> ListAsync(int page, int pageSize, Guid? locationId,
        string? status, string roomSearch, CancellationToken token, Guid? roomId = null, string? stage = null);
    Task<HandoverDraftState?> GetAsync(Guid contractId, CancellationToken token);
    Task<bool> ReplaceAsync(Guid contractId, int previousVersion, HandoverDraftState next,
        CancellationToken token);
}

public interface IHandoverDraftPdfRenderer
{
    Task<byte[]> RenderDraftAsync(HandoverDraftView draft, CancellationToken token);
    Task<byte[]> RenderSigningAsync(HandoverDraftView draft, HandoverDocumentPhoto[] photos,
        CancellationToken token);
}
