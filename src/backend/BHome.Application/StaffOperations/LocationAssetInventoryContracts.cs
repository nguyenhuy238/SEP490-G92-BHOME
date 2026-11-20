using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.StaffOperations;

// One immutable assignment baseline. Only Checked/Note/IncidentId can change while Staff inspects.
public sealed record LocationAssetInventoryItem(Guid Id, Guid? RoomId, string? RoomNumber,
    Guid? AssetId, string Name, int Quantity, string? CommonArea,
    bool Checked = false, bool Inherited = false, Guid? SourceHandoverContractId = null,
    string? Note = null, Guid? IncidentId = null);

public sealed record LocationAssetInventorySnapshot(Guid AssignmentId, DateOnly EffectiveFrom,
    LocationAssetInventoryItem[] Items)
{
    // Not checklist entries: Owner has not yet attested the remaining rooms/common
    // configuration. Never represent these as Staff-checked or empty rooms.
    public string[] PendingOwnerRooms { get; init; } = [];
    public bool PendingOwnerCommonAssets { get; init; }
}

public sealed record LocationAssetInventoryView(Guid TaskId, Guid LocationId, Guid AssignmentId,
    string Status, int Version, int TotalCount, int CheckedCount, IReadOnlyList<LocationAssetInventoryItem> Items,
    IReadOnlyList<string>? PendingOwnerRooms = null, bool PendingOwnerCommonAssets = false);

public sealed record LocationAssetInventoryReconcilePreview(Guid TaskId, int Version,
    int CurrentCount, int OwnerConfirmedCount, int RemovedCount, int AddedCount,
    int PreservedChecks, bool CanApply, string? BlockedReason);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationAssetInventoryReconcileCommand(int Version, [property: JsonRequired] bool Confirmed);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationAssetInventoryItemWrite(int Version, [property: JsonRequired] bool Checked,
    [StringLength(2000)] string? Note = null, Guid? IncidentId = null);
