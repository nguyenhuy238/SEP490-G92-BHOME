using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;

namespace BHome.Application.StaffOperations;

public sealed partial class OperationalTaskService
{
    private static LocationAssetInventorySnapshot LocationInventory(OperationalTask task)
    {
        if (task.Kind != OperationalTaskKind.LocationAssetHandover || string.IsNullOrWhiteSpace(task.LocationAssetInventoryJson))
            throw OperationalTaskException.Missing();
        try
        {
            var snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.LocationAssetInventoryJson);
            if (snapshot?.Items is null || snapshot.AssignmentId != task.AssignmentId ||
                snapshot.Items.Select(item => item.Id).Distinct().Count() != snapshot.Items.Length)
                throw OperationalTaskException.Conflict("location_asset_inventory_invalid_snapshot");
            return snapshot;
        }
        catch (JsonException)
        {
            throw OperationalTaskException.Conflict("location_asset_inventory_invalid_snapshot");
        }
    }

    private static LocationAssetInventoryView LocationInventoryView(OperationalTask task, LocationAssetInventorySnapshot snapshot) =>
        new(task.Id, task.LocationId, snapshot.AssignmentId, task.Status.ToString(), task.Version,
            snapshot.Items.Length, snapshot.Items.Count(item => item.Checked), snapshot.Items,
            snapshot.PendingOwnerRooms, snapshot.PendingOwnerCommonAssets);

    public async Task<LocationAssetInventoryView> LocationAssetInventoryAsync(Guid taskId, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.View);
        var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(task, t);
        return LocationInventoryView(task, LocationInventory(task));
    }

    private static LocationAssetInventoryReconcilePreview PreviewReconciliation(OperationalTask task,
        LocationAssetInventorySnapshot current, LocationAssetInventorySnapshot confirmed)
    {
        if (confirmed.AssignmentId != task.AssignmentId ||
            confirmed.Items.Select(i => i.Id).Distinct().Count() != confirmed.Items.Length)
            throw OperationalTaskException.Conflict("location_asset_inventory_invalid_owner_source");
        var currentIds = current.Items.Select(item => item.Id).ToHashSet();
        var confirmedIds = confirmed.Items.Select(item => item.Id).ToHashSet();
        var removed = current.Items.Where(item => !confirmedIds.Contains(item.Id)).ToArray();
        var checkedRemoved = removed.Any(item => item.Checked || item.Inherited || item.IncidentId.HasValue ||
            !string.IsNullOrWhiteSpace(item.Note));
        var materialChanged = confirmed.Items.Any(item => current.Items.Any(previous => previous.Id == item.Id &&
            (previous.Checked || previous.Inherited || previous.IncidentId.HasValue || !string.IsNullOrWhiteSpace(previous.Note)) &&
            !SameOwnerItem(previous, item)));
        var inheritedChanged = confirmed.Items.Any(item => current.Items.Any(previous => previous.Id == item.Id &&
            previous.Inherited && (!item.Inherited || item.SourceHandoverContractId != previous.SourceHandoverContractId)));
        var reason = task.Status is not (MeterTaskStatus.Assigned or MeterTaskStatus.InProgress)
            ? "location_asset_inventory_reconciliation_locked"
            : confirmed.Items.Length == 0 ? "location_asset_inventory_owner_confirmation_required"
            : checkedRemoved || inheritedChanged || materialChanged ? "location_asset_inventory_staff_work_conflict" : null;
        return new(task.Id, task.Version, current.Items.Length, confirmed.Items.Length,
            removed.Length, confirmed.Items.Count(item => !currentIds.Contains(item.Id)),
            current.Items.Count(item => item.Checked || item.IncidentId.HasValue || !string.IsNullOrWhiteSpace(item.Note)),
            reason is null, reason);
    }

    private static bool SameOwnerItem(LocationAssetInventoryItem left, LocationAssetInventoryItem right) =>
        left.Id == right.Id && left.RoomId == right.RoomId && left.RoomNumber == right.RoomNumber &&
        left.AssetId == right.AssetId && left.Name == right.Name && left.Quantity == right.Quantity &&
        left.CommonArea == right.CommonArea && left.Inherited == right.Inherited &&
        left.SourceHandoverContractId == right.SourceHandoverContractId;

    // Owner-facing read-only diff; never changes an in-progress or signed document by itself.
    public async Task<LocationAssetInventoryReconcilePreview> PreviewLocationAssetInventoryReconciliationAsync(
        Guid taskId, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Manage);
        if (!Owner) throw new OperationalTaskException(403, "owner_required");
        var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(task, t);
        var current = LocationInventory(task);
        var confirmed = await repository.OwnerConfirmedInventoryAsync(task, t);
        return PreviewReconciliation(task, current, confirmed);
    }

    // Explicit Owner action only, serialized with Staff item updates via the Location lock.
    public async Task<LocationAssetInventoryView> ReconcileLocationAssetInventoryAsync(Guid taskId,
        LocationAssetInventoryReconcileCommand input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Manage);
        if (!Owner) throw new OperationalTaskException(403, "owner_required");
        Validate(input);
        if (!input.Confirmed || input.Version < 1) throw OperationalTaskException.Invalid("owner_confirmation_required");
        var initial = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(initial, t);
        _ = LocationInventory(initial);
        return await CommandAsync(initial.LocationId, key, $"location-asset-inventory-reconcile:{taskId}",
            new { taskId, input }, async () =>
            {
                var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
                await AccessAsync(task, t);
                if (task.Version != input.Version) throw OperationalTaskException.Conflict("stale_version");
                var current = LocationInventory(task);
                var confirmed = await repository.OwnerConfirmedInventoryAsync(task, t);
                var preview = PreviewReconciliation(task, current, confirmed);
                if (!preview.CanApply) throw OperationalTaskException.Conflict(preview.BlockedReason!);
                var byId = current.Items.ToDictionary(item => item.Id);
                var merged = confirmed with
                {
                    Items = confirmed.Items.Select(item => byId.TryGetValue(item.Id, out var previous)
                        ? item with
                        {
                            Checked = item.Checked || previous.Checked,
                            Note = previous.Note,
                            IncidentId = previous.IncidentId,
                            PriorStaffTaskId = previous.PriorStaffTaskId,
                            PriorStaffUserId = previous.PriorStaffUserId
                        }
                        : item).ToArray()
                };
                // No-op refresh is idempotent and does not create a redundant history version.
                if (JsonSerializer.Serialize(current) == JsonSerializer.Serialize(merged))
                    return LocationInventoryView(task, current);
                repository.Track(task);
                task.LocationAssetInventoryJson = JsonSerializer.Serialize(merged);
                await RecordAsync(task, "location_asset_inventory_owner_reconciled", "Owner xác nhận lại phạm vi kiểm kê",
                    new
                    {
                        previousCount = preview.CurrentCount,
                        ownerConfirmedCount = preview.OwnerConfirmedCount,
                        removedCount = preview.RemovedCount,
                        addedCount = preview.AddedCount,
                        preservedChecks = preview.PreservedChecks,
                        source = "OwnerConfirmedInventory"
                    },
                    task.AssignedStaffUserId is { } staff ? [staff] : [], t);
                task.Version++;
                return LocationInventoryView(task, merged);
            }, view => view.TaskId, t);
    }

    public async Task<LocationAssetInventoryView> UpdateLocationAssetInventoryItemAsync(Guid taskId, Guid itemId,
        LocationAssetInventoryItemWrite input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Execute);
        Validate(input);
        if (itemId == Guid.Empty || input.IncidentId == Guid.Empty || input.Note?.Length > 2000)
            throw OperationalTaskException.Invalid("invalid_location_asset_inventory_item");
        var initial = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(initial, t, true);
        if (initial.Kind != OperationalTaskKind.LocationAssetHandover) throw OperationalTaskException.Missing();
        return await CommandAsync(initial.LocationId, key, $"location-asset-inventory-item:{taskId}:{itemId}",
            new { taskId, itemId, input }, async () =>
            {
                var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
                await AccessAsync(task, t, true);
                if (task.Kind != OperationalTaskKind.LocationAssetHandover) throw OperationalTaskException.Missing();
                if (task.Version != input.Version) throw OperationalTaskException.Conflict("stale_version");
                if (task.Status != MeterTaskStatus.InProgress)
                    throw OperationalTaskException.Conflict("location_asset_inventory_not_in_progress");
                var snapshot = LocationInventory(task);
                var index = Array.FindIndex(snapshot.Items, item => item.Id == itemId);
                if (index < 0) throw OperationalTaskException.Missing();
                var previous = snapshot.Items[index];
                if (previous.Inherited)
                    throw OperationalTaskException.Conflict("location_asset_inventory_inherited_item_immutable");
                if (input.IncidentId is { } incidentId)
                {
                    var report = (await repository.IncidentTargetsAsync([incidentId], t)).SingleOrDefault();
                    if (report is null || report.LocationId != task.LocationId || report.RoomId != previous.RoomId ||
                        report.AssetId != previous.AssetId || !report.IsValidReport ||
                        (previous.IncidentId != incidentId && report.ReporterId != Actor))
                        throw OperationalTaskException.Invalid("invalid_location_asset_inventory_incident");
                }
                if (input.IncidentId.HasValue && string.IsNullOrWhiteSpace(input.Note))
                    throw OperationalTaskException.Invalid("location_asset_inventory_issue_note_required");
                repository.Track(task);
                snapshot.Items[index] = previous with
                {
                    Checked = input.Checked,
                    Note = input.Note?.Trim(),
                    IncidentId = input.IncidentId,
                    // A direct successor check supersedes previously inherited progress.
                    PriorStaffTaskId = null,
                    PriorStaffUserId = null
                };
                task.LocationAssetInventoryJson = JsonSerializer.Serialize(snapshot);
                await RecordAsync(task, "location_asset_inventory_item_checked", input.Note?.Trim() ?? "",
                    new { ItemId = itemId, input.Checked, input.IncidentId }, [], t);
                task.Version++;
                return LocationInventoryView(task, snapshot);
            }, view => view.TaskId, t);
    }

    // Staff submits via the ordinary task action. Owner approval/signatures own the final completion.
    private async Task ValidateLocationAssetInventorySubmissionAsync(OperationalTask task, CancellationToken t)
    {
        var snapshot = LocationInventory(task);
        if (snapshot.Items.Length == 0)
            throw OperationalTaskException.Conflict("location_asset_inventory_owner_confirmation_required");
        if (snapshot.Items.Any(item => !item.Checked))
            throw OperationalTaskException.Conflict("location_asset_inventory_incomplete");
        // A late Owner change (or a never-verified legacy task) must not reach signing.
        var verified = await repository.OwnerConfirmedInventoryAsync(task, t);
        if (snapshot.Items.Length != verified.Items.Length ||
            !snapshot.Items.OrderBy(i => i.Id).Zip(verified.Items.OrderBy(i => i.Id))
                .All(pair => SameOwnerItem(pair.First, pair.Second)) ||
            !(snapshot.PendingOwnerRooms ?? []).Order().SequenceEqual((verified.PendingOwnerRooms ?? []).Order()) ||
            snapshot.PendingOwnerCommonAssets != verified.PendingOwnerCommonAssets)
            throw OperationalTaskException.Conflict("location_asset_inventory_owner_source_changed");
        if ((snapshot.PendingOwnerRooms?.Length ?? 0) > 0 || snapshot.PendingOwnerCommonAssets)
            throw OperationalTaskException.Conflict("location_asset_inventory_pending_owner_confirmation");
    }
}
