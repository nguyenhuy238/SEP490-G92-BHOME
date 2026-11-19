using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

// A mutable move-in preparation lives alongside, not inside, the signed Main contract.
// The Compact24 storage envelope is contracts.handover.preparation; the confirmed
// baseline remains contracts.handover.current and keeps its existing invariants.
public sealed record HandoverDraftRequest(Guid Id, int Version, string Reason, string Status,
    DateTimeOffset CreatedAt, string? DecisionReason = null, Guid? ReviewedBy = null, DateTimeOffset? ReviewedAt = null);

// A fixed room checklist prevents a single free-text answer from hiding an
// uninspected wall, door, electrical outlet or safety installation.
public sealed record HandoverRoomCheck(string Code, string Status, string Notes, Guid[] EvidenceIds);
public sealed record HandoverAccessItem(string Type, int Quantity, string Notes);
public sealed record HandoverOutstandingIssue(string Code, string Description, string ResponsibleParty,
    DateOnly? DueDate);
// Status is sourced from the existing authorized OperationalTask workflow, not
// inferred from draft contents. Start via /api/v1/operational-tasks/{id}/start.
// The legacy pre-handover inventory remains a backend checkpoint, but is surfaced
// as a subsection of the single Staff move-in job rather than a second work card.
public sealed record HandoverMoveInTask(Guid Id, string Status, int Version, bool CanInspect,
    Guid? InventoryTaskId = null, string? InventoryStatus = null);

public sealed record HandoverDraftState(
    int Version, string Status, string ContractSnapshotHash, DateTimeOffset CreatedAt,
    string RoomCondition, string KeysAndAccess, string Notes, HandoverAssetInput[] Assets,
    Guid[] EvidenceIds, string? InventoryToken, Guid? StaffPreparedBy, DateTimeOffset? StaffPreparedAt,
    Guid? OwnerReadyBy, DateTimeOffset? OwnerReadyAt, Guid? TenantConfirmedBy,
    DateTimeOffset? TenantConfirmedAt, HandoverDraftRequest[] Requests,
    Guid? ApprovedElectricityReadingId = null, Guid? ApprovedWaterReadingId = null,
    string? OwnerReadyReason = null, string? OwnerHandlingPlan = null,
    HandoverRoomCheck[]? RoomChecks = null, HandoverAccessItem[]? AccessItems = null,
    HandoverOutstandingIssue[]? OutstandingIssues = null)
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
    HandoverMoveInTask? MoveInTask = null);

public sealed record HandoverDraftWrite(int Version, string? RoomCondition = null,
    string? KeysAndAccess = null, string? Notes = null, HandoverAssetInput[]? Assets = null,
    Guid[]? EvidenceIds = null, string? InventoryToken = null,
    HandoverRoomCheck[]? RoomChecks = null, HandoverAccessItem[]? AccessItems = null,
    // Backward-compatible wire property. Staff may clear old proposals with []
    // but cannot create a repair assignment, deadline or remediation plan.
    HandoverOutstandingIssue[]? OutstandingIssues = null);
public sealed record HandoverDraftReady(int Version, string? Reason = null, string? HandlingPlan = null);
public sealed record HandoverDraftCorrection(int Version, string Reason);
public sealed record HandoverDraftCorrectionDecision(int Version, bool Accepted, string Reason);
public sealed record HandoverDraftTenantConfirmation(int Version, string? Note = null);

public interface IHandoverDraftRepository
{
    Task<HandoverDraftState?> GetAsync(Guid contractId, CancellationToken token);
    Task<bool> ReplaceAsync(Guid contractId, int previousVersion, HandoverDraftState next,
        CancellationToken token);
}

public interface IHandoverDraftPdfRenderer
{
    Task<byte[]> RenderDraftAsync(HandoverDraftView draft, CancellationToken token);
}
