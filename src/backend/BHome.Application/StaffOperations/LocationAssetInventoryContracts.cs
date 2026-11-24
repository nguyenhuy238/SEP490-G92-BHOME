using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.StaffOperations;

// One immutable Location baseline. AssignmentId identifies the current responsible Staff;
// item observations and their provenance survive responsibility changes on the same task.
public sealed record LocationAssetInventoryItem(Guid Id, Guid? RoomId, string? RoomNumber,
    Guid? AssetId, string Name, int Quantity, string? CommonArea,
    bool Checked = false, bool Inherited = false, Guid? SourceHandoverContractId = null,
    string? Note = null, Guid? IncidentId = null)
{
    // Condition is a Staff observation, not an Owner asset-status mutation. The default keeps
    // snapshots created before this field existed readable without inventing an observation.
    public string Condition { get; init; } = "Unassessed";
    // Audit provenance when a successor continues matching checks from a superseded task.
    // This does not make a prior Staff's signature the successor's signature.
    public Guid? PriorStaffTaskId { get; init; }
    public Guid? PriorStaffUserId { get; init; }
    // An Owner rework decision can challenge an otherwise valid Tenant baseline.
    // Keep the exact challenged source so automatic refresh cannot silently re-inherit it.
    public Guid? RecheckOfHandoverContractId { get; init; }
}

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
    [StringLength(2000)] string? Note = null, Guid? IncidentId = null)
{
    // Older Mobile clients did not send Condition. Preserve their checked=true semantics as an
    // intact observation; checked=false is normalized to Unassessed by the service.
    public string Condition { get; init; } = "Intact";
}
