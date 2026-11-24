using System.Text.Json;
using BHome.Domain.Billing;

namespace BHome.Application.StaffOperations;

public static class LocationAssetInventorySync
{
    public const string Result = "Đã hoàn tất kiểm kê tài sản; hệ thống tự chuyển sang chờ Owner duyệt biên bản.";

    public static bool SameOwnerItem(LocationAssetInventoryItem left, LocationAssetInventoryItem right) =>
        left.Id == right.Id && left.RoomId == right.RoomId && left.RoomNumber == right.RoomNumber &&
        left.AssetId == right.AssetId && left.Name == right.Name && left.Quantity == right.Quantity &&
        left.CommonArea == right.CommonArea &&
        ((left.Inherited == right.Inherited && left.SourceHandoverContractId == right.SourceHandoverContractId) ||
         (!left.Inherited && left.SourceHandoverContractId is null && right.Inherited &&
          left.RecheckOfHandoverContractId is { } challenged && challenged == right.SourceHandoverContractId));

    public static bool HasStaffWork(LocationAssetInventoryItem item) =>
        item.Checked || item.Inherited || item.IncidentId.HasValue || item.RecheckOfHandoverContractId.HasValue ||
        !string.IsNullOrWhiteSpace(item.Note);

    // Never silently discard a Staff observation or change the identity of an inherited item.
    public static bool TryMerge(LocationAssetInventorySnapshot current, LocationAssetInventorySnapshot confirmed,
        out LocationAssetInventorySnapshot merged)
    {
        merged = current;
        if (current.AssignmentId != confirmed.AssignmentId ||
            current.Items.Select(i => i.Id).Distinct().Count() != current.Items.Length ||
            confirmed.Items.Select(i => i.Id).Distinct().Count() != confirmed.Items.Length) return false;
        var next = confirmed.Items.ToDictionary(i => i.Id);
        if (current.Items.Any(i => HasStaffWork(i) &&
            (!next.TryGetValue(i.Id, out var replacement) || !SameOwnerItem(i, replacement)))) return false;
        var old = current.Items.ToDictionary(i => i.Id);
        merged = confirmed with
        {
            EffectiveFrom = current.EffectiveFrom,
            Items = confirmed.Items.Select(i => old.TryGetValue(i.Id, out var previous) && SameOwnerItem(previous, i)
                ? i with
                {
                    Checked = previous.RecheckOfHandoverContractId.HasValue ? previous.Checked : i.Checked || previous.Checked,
                    Inherited = previous.RecheckOfHandoverContractId.HasValue ? false : i.Inherited,
                    SourceHandoverContractId = previous.RecheckOfHandoverContractId.HasValue ? null : i.SourceHandoverContractId,
                    Condition = previous.Condition,
                    Note = previous.Note,
                    IncidentId = previous.IncidentId,
                    PriorStaffTaskId = previous.PriorStaffTaskId,
                    PriorStaffUserId = previous.PriorStaffUserId,
                    RecheckOfHandoverContractId = previous.RecheckOfHandoverContractId
                } : i).ToArray()
        };
        return true;
    }

    public static bool Changed(LocationAssetInventorySnapshot current, LocationAssetInventorySnapshot merged) =>
        JsonSerializer.Serialize(current) != JsonSerializer.Serialize(merged);

    public static bool Ready(OperationalTask task, LocationAssetInventorySnapshot snapshot) =>
        task.Status == MeterTaskStatus.InProgress && !task.EvidenceRequired &&
        snapshot.Items.Length > 0 && (snapshot.PendingOwnerRooms?.Length ?? 0) == 0 &&
        !snapshot.PendingOwnerCommonAssets && snapshot.Items.All(item => item.Checked &&
            (item.Condition is "Unassessed" or "Intact" or "Missing" or "Damaged" or "NotAccessible") &&
            (item.Condition is not ("Missing" or "Damaged") ||
                (!string.IsNullOrWhiteSpace(item.Note) && item.IncidentId.HasValue)) &&
            (item.Condition != "NotAccessible" || !string.IsNullOrWhiteSpace(item.Note)));
}
