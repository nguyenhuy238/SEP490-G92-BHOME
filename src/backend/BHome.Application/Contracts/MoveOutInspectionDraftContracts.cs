namespace BHome.Application.Contracts;

// A Staff-only working copy; it is never part of the Owner-reviewed final
// inspection. Compact24 stores it at contracts.move_out.inspectionDraft.
public sealed record MoveOutInspectionDraftState(
    int Version, Guid ContractId, Guid StaffUserId, string ContractSnapshotHash,
    DateTimeOffset UpdatedAt, string RoomCondition, string KeysAndAccess, string Notes,
    HandoverAssetInput[] Assets, HandoverRoomCheck[] RoomChecks,
    HandoverAccessItem[] AccessItems, Guid[] EvidenceIds, Guid[] KeyEvidenceIds,
    Guid? ElectricityReadingId = null, Guid? WaterReadingId = null,
    string? InventoryToken = null, string? ProposedCompensation = null,
    MoveOutPhysicalItemEvidence[]? PhysicalItemEvidence = null)
{
    public static MoveOutInspectionDraftState Empty(Guid contractId, Guid actor,
        string snapshotHash, DateTimeOffset now, int version = 0) =>
        new(version, contractId, actor, snapshotHash, now, "", "", "",
            [], [], [], [], []);
}

public sealed record MoveOutInspectionDraftView(
    int Version, Guid ContractId, string Status, string RoomCondition,
    string KeysAndAccess, string Notes, HandoverAssetInput[] Assets,
    HandoverRoomCheck[] RoomChecks, HandoverAccessItem[] AccessItems,
    Guid[] EvidenceIds, Guid[] KeyEvidenceIds, Guid? ElectricityReadingId,
    Guid? WaterReadingId, string? InventoryToken, string? ProposedCompensation,
    DateTimeOffset UpdatedAt, MoveOutPhysicalItemEvidence[]? PhysicalItemEvidence = null);

// Nullable fields mean "keep existing"; arrays are merged by asset Id/room Code.
// An empty array clears the corresponding optional collection where appropriate.
public sealed record MoveOutInspectionDraftWrite(
    int Version,
    string? RoomCondition = null,
    string? KeysAndAccess = null,
    string? Notes = null,
    HandoverAssetInput[]? Assets = null,
    HandoverRoomCheck[]? RoomChecks = null,
    HandoverAccessItem[]? AccessItems = null,
    Guid[]? EvidenceIds = null,
    Guid[]? KeyEvidenceIds = null,
    Guid? ElectricityReadingId = null,
    Guid? WaterReadingId = null,
    string? InventoryToken = null,
    string? ProposedCompensation = null,
    MoveOutPhysicalItemEvidence[]? PhysicalItemEvidence = null);
