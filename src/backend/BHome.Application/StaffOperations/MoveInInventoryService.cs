using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.StaffOperations;

public sealed partial class OperationalTaskService
{
    private static MoveInInventorySnapshot Inventory(OperationalTask task)
    {
        if (task.Kind != OperationalTaskKind.MoveInInventory || task.ContractId is null ||
            task.TargetRoomId is null || string.IsNullOrWhiteSpace(task.MoveInInventoryJson))
            throw OperationalTaskException.Missing();
        try
        {
            var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(task.MoveInInventoryJson);
            if (snapshot?.Items is null || snapshot.Items.Length > 200 ||
                snapshot.Items.Any(x => x.Id == Guid.Empty || x.ExpectedQuantity < 0 || x.ExpectedQuantity > 1000000))
                throw OperationalTaskException.Conflict("move_in_inventory_snapshot_invalid");
            return snapshot;
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("move_in_inventory_snapshot_invalid"); }
    }

    private static string? Outcome(MoveInInventoryItem[] items)
    {
        if (items.Any(x => x.Condition is null)) return null;
        if (items.Any(x => x.Condition == "Damaged")) return "Damaged";
        if (items.Any(x => x.Condition == "Missing")) return "Missing";
        return "Good";
    }

    private async Task<MoveInInventoryView> InventoryViewAsync(OperationalTask task, MoveInInventorySnapshot snapshot, CancellationToken t)
    {
        var unresolved = snapshot.Items.Any(i => (i.Condition is "Missing" or "Damaged") && i.IncidentId is null);
        var ids = snapshot.Items.Where(i => (i.Condition is "Missing" or "Damaged") && i.IncidentId.HasValue)
            .Select(i => i.IncidentId!.Value).ToArray();
        var ready = task.Status == MeterTaskStatus.Completed && !unresolved &&
            await repository.IncidentsResolvedAsync(ids, t);
        return new(task.Id, task.ContractId!.Value, task.TargetRoomId!.Value, task.LocationId,
            task.Status.ToString(), Outcome(snapshot.Items), task.Version, task.DueAt, task.CompletedAt,
            ready, snapshot.Items);
    }

    public async Task<MoveInInventoryView> MoveInInventoryAsync(Guid id, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.View);
        var task = await repository.FindAsync(id, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(task, t);
        return await InventoryViewAsync(task, Inventory(task), t);
    }

    public async Task<MoveInInventoryView> UpdateInventoryItemAsync(Guid taskId, Guid itemId,
        MoveInInventoryItemWrite input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Execute);
        Validate(input);
        if (itemId == Guid.Empty || input.ActualQuantity < 0 ||
            input.Condition is not ("Good" or "Missing" or "Damaged") ||
            input.EvidenceIds is null || input.EvidenceIds.Length is < 1 or > 5 ||
            input.EvidenceIds.Any(x => x == Guid.Empty) ||
            input.EvidenceIds.Distinct().Count() != input.EvidenceIds.Length ||
            input.IncidentId == Guid.Empty || input.Notes?.Length > 2000 ||
            input.Condition is "Missing" or "Damaged" && string.IsNullOrWhiteSpace(input.Notes))
            throw OperationalTaskException.Invalid("invalid_move_in_inventory_item");
        var initial = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(initial, t, true);
        if (initial.Kind != OperationalTaskKind.MoveInInventory) throw OperationalTaskException.Missing();
        return await CommandAsync(initial.LocationId, key, "move-in-inventory-item:" + taskId + ":" + itemId,
            new { taskId, itemId, input }, async () =>
            {
                var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
                await AccessAsync(task, t, true);
                if (task.Kind != OperationalTaskKind.MoveInInventory) throw OperationalTaskException.Missing();
                await EnsureMoveInMainWorkStartedAsync(task, t);
                if (task.Version != input.Version) throw OperationalTaskException.Conflict("stale_version");
                if (task.Status != MeterTaskStatus.InProgress)
                    throw OperationalTaskException.Conflict("move_in_inventory_not_in_progress");
                var snapshot = Inventory(task);
                var index = Array.FindIndex(snapshot.Items, x => x.Id == itemId);
                if (index < 0) throw OperationalTaskException.Missing();
                var previous = snapshot.Items[index];
                if (input.ActualQuantity > previous.ExpectedQuantity ||
                    input.Condition == "Good" && input.ActualQuantity != previous.ExpectedQuantity ||
                    input.Condition == "Missing" && input.ActualQuantity >= previous.ExpectedQuantity)
                    throw OperationalTaskException.Invalid("move_in_inventory_quantity_condition_mismatch");
                if (input.IncidentId is { } incidentId)
                {
                    var incident = (await repository.IncidentTargetsAsync([incidentId], t)).SingleOrDefault();
                    if (incident is null || incident.LocationId != task.LocationId ||
                        incident.RoomId != task.TargetRoomId || incident.AssetId != previous.AssetId ||
                        (previous.IncidentId != incidentId && incident.ReporterId != Actor) || !incident.IsValidReport)
                        throw OperationalTaskException.Invalid("invalid_move_in_inventory_incident");
                }
                var evidence = await repository.EvidenceAsync(taskId, t);
                if (input.EvidenceIds.Except(evidence.Select(e => e.Id)).Any() ||
                    snapshot.Items.Where(x => x.Id != itemId)
                        .Any(x => (x.EvidenceIds ?? []).Intersect(input.EvidenceIds).Any()))
                    throw OperationalTaskException.Invalid("invalid_move_in_inventory_evidence");
                // The upload path already validated and saved every private object.
                // Re-streaming large images during each checklist save is unnecessary.
                repository.Track(task);
                var responsible = await repository.ResponsibilityAsync(task.LocationId, Today, t);
                await SynchronizeResponsibilityAsync(task, responsible, t);
                snapshot.Items[index] = previous with
                {
                    ActualQuantity = input.ActualQuantity,
                    Condition = input.Condition,
                    Notes = input.Notes?.Trim(),
                    EvidenceIds = input.EvidenceIds,
                    IncidentId = input.IncidentId
                };
                task.MoveInInventoryJson = JsonSerializer.Serialize(snapshot);
                await RecordAsync(task, "move_in_inventory_item_checked", input.Notes?.Trim() ?? "",
                    new { itemId, input.ActualQuantity, input.Condition, input.EvidenceIds, input.IncidentId }, [], t);
                task.Version++;
                return await InventoryViewAsync(task, snapshot, t);
            }, result => result.TaskId, t);
    }

    public async Task<MoveInInventoryView> CompleteMoveInInventoryAsync(Guid taskId,
        MoveInInventoryComplete input, Guid key, CancellationToken t)
    {
        Permit(Permissions.OperationalTasks.Execute);
        Validate(input);
        var initial = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
        await AccessAsync(initial, t, true);
        if (initial.Kind != OperationalTaskKind.MoveInInventory) throw OperationalTaskException.Missing();
        return await CommandAsync(initial.LocationId, key, "move-in-inventory-complete:" + taskId,
            new { taskId, input }, async () =>
            {
                var task = await repository.FindAsync(taskId, t) ?? throw OperationalTaskException.Missing();
                await AccessAsync(task, t, true);
                if (task.Kind != OperationalTaskKind.MoveInInventory) throw OperationalTaskException.Missing();
                await EnsureMoveInMainWorkStartedAsync(task, t);
                if (task.Version != input.Version) throw OperationalTaskException.Conflict("stale_version");
                if (task.Status != MeterTaskStatus.InProgress)
                    throw OperationalTaskException.Conflict("move_in_inventory_not_in_progress");
                var snapshot = Inventory(task);
                if (snapshot.Items.Length == 0 && !input.ConfirmNoAssets)
                    throw OperationalTaskException.Conflict("move_in_inventory_no_assets_confirmation_required");
                if (snapshot.Items.Any(i => i.Condition is null || i.ActualQuantity is null ||
                    i.EvidenceIds is null || i.EvidenceIds.Length == 0))
                    throw OperationalTaskException.Conflict("move_in_inventory_checklist_incomplete");
                if (snapshot.Items.Any(i => (i.Condition is "Missing" or "Damaged") && i.IncidentId is null))
                    throw OperationalTaskException.Conflict("move_in_inventory_incident_required");
                var evidence = (await repository.EvidenceAsync(taskId, t)).Select(e => e.Id).ToHashSet();
                if (snapshot.Items.SelectMany(i => i.EvidenceIds ?? []).Any(id => !evidence.Contains(id)))
                    throw OperationalTaskException.Conflict("move_in_inventory_evidence_missing");
                var incidentIds = snapshot.Items.Where(i => i.Condition is "Missing" or "Damaged")
                    .Select(i => i.IncidentId!.Value).Distinct().ToArray();
                var incidents = (await repository.IncidentTargetsAsync(incidentIds, t))
                    .ToDictionary(i => i.Id);
                foreach (var item in snapshot.Items.Where(i => i.Condition is "Missing" or "Damaged"))
                {
                    if (!incidents.TryGetValue(item.IncidentId!.Value, out var incident) ||
                        incident.LocationId != task.LocationId ||
                        incident.RoomId != task.TargetRoomId || incident.AssetId != item.AssetId ||
                        !incident.IsValidReport)
                        throw OperationalTaskException.Conflict("move_in_inventory_incident_invalid");
                }
                repository.Track(task);
                var responsible = await repository.ResponsibilityAsync(task.LocationId, Today, t);
                await SynchronizeResponsibilityAsync(task, responsible, t);
                task.Status = MeterTaskStatus.Completed;
                task.CompletedAt = Now;
                task.Result = $"Đã kiểm kê {snapshot.Items.Length} mục: {snapshot.Items.Count(x => x.Condition == "Good")} đạt, " +
                    $"{snapshot.Items.Count(x => x.Condition == "Missing")} thiếu, {snapshot.Items.Count(x => x.Condition == "Damaged")} hư hỏng. " +
                    (input.Note?.Trim() ?? "");
                var owners = await repository.OwnersAsync(t);
                await RecordAsync(task, "move_in_inventory_completed", input.Note?.Trim() ?? "",
                    new
                    {
                        Outcome = Outcome(snapshot.Items),
                        CompletedAt = task.CompletedAt,
                        Items = snapshot.Items.Select(i => new { i.Id, i.Condition, i.ActualQuantity, i.IncidentId })
                    },
                    owners, t);
                task.Version++;
                await repository.NotifyMoveInInventoryCompletedAsync(task, Actor, t);
                return await InventoryViewAsync(task, snapshot, t);
            }, result => result.TaskId, t);
    }
}
