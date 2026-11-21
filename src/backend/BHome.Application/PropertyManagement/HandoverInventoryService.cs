using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

public sealed record RoomNoAssetsConfirmation(string StateToken, string Reason);

// Uses the same configuration resolution and stable verification mappings as Owner inventory review.
// Staff receives only operational quantities/condition, never acquisition costs or the Owner-only API.
public sealed partial class RoomInventoryReviewService : IHandoverInventory
{
    private async Task<RoomContext> HandoverContext(Guid room, CancellationToken t)
    {
        var location = await RoomScope(room, false, t);
        return (await SnapshotAsync(location, true, [], t)).Rooms.SingleOrDefault(r => r.Room.Id == room)
            ?? throw new PropertyException(404, "resource_not_found");
    }

    private static HandoverPhysicalAsset PhysicalView(Physical p) =>
        new(p.Asset.Id, p.Asset.Version, p.Metadata.Quantity, p.Asset.Condition, p.Asset.Status.ToString());
    private static string EmptyInventoryBaseline(RoomContext room) => EmptyInventoryBaseline(room.Room.Id, room.Assignment, room.Desired);
    private static string EmptyInventoryBaseline(Guid roomId, SetupDocument? assignmentDocument, SetupDocument? desiredDocument) => Hash(new
    {
        Id = roomId,
        assignment = assignmentDocument is null ? null : new { assignmentDocument.Id, assignmentDocument.Version },
        desired = desiredDocument is null ? null : new { desiredDocument.Id, desiredDocument.Version }
    });

    private async Task<HandoverInventory> HandoverInventory(RoomContext room, CancellationToken t)
    {
        var empty = await Store.GetAsync(Key($"room-no-assets:{room.Room.Id:N}"), "RoomNoAssets", t);
        var noAssets = room.Items.Length == 0 && room.Physical.Length == 0 && empty is not null &&
            empty.Data.GetProperty("baseline").GetString() == EmptyInventoryBaseline(room);
        var groups = room.Items.Select(item => new HandoverAsset(item.Requirement.Id, item.Requirement.Name,
            string.Join("; ", item.Linked.Select(p => p.Asset.Condition).Distinct()), "", item.Requirement.Id,
            item.Requirement.Quantity, item.Requirement.Unit, item.Requirement.TrackingMode,
            item.Linked.Select(PhysicalView).ToArray(), room.View.Items.Single(i => i.Id == item.Requirement.Id).Checked))
            .Concat(room.Unlinked.Select(p => new HandoverAsset(p.Asset.Id, p.Asset.Name, p.Asset.Condition, "",
                null, null, p.Metadata.Unit, p.Metadata.TrackingMode, [PhysicalView(p)]))).ToArray();
        if (groups.Length > 200) throw new PropertyException(409, "handover_inventory_limit");
        // Reinspection flags/evidence-only appends do not change the inspected asset baseline.
        return new(Hash(new { room.Baseline, noAssetsVersion = noAssets ? empty!.Version : 0 }), room.View.State, noAssets, groups);
    }

    public async Task<HandoverInventory> PrepareAsync(Guid roomId, CancellationToken t) =>
        await HandoverInventory(await HandoverContext(roomId, t), t);

    public async Task<HandoverInventory> PrepareForContractAsync(Guid roomId, Guid? tenantUserId, CancellationToken t)
    {
        // Normal room-inventory operations are Owner/Staff-only. Tenant may
        // inspect the *same* scoped snapshot only through an authorized
        // contract, without exposing the underlying Owner configuration APIs.
        var location = await Store.RoomLocationAsync(roomId, t)
            ?? throw new PropertyException(404, "resource_not_found");
        if (!await Access.CanAccessAsync(new(location, tenantUserId),
                [Roles.Owner, Roles.Staff, Roles.Tenant], t))
            throw new PropertyException(404, "resource_not_found");
        var context = (await SnapshotAsync(location, true, [], t)).Rooms.SingleOrDefault(r => r.Room.Id == roomId)
            ?? throw new PropertyException(404, "resource_not_found");
        return await HandoverInventory(context, t);
    }

    // Trusted contract activation job has no signed-in actor. Resolve only the
    // inventory snapshot; external HTTP callers must continue through RoomScope.
    public async Task<HandoverInventory> PrepareForMoveInTaskAsync(Guid roomId, CancellationToken t)
    {
        var location = await Store.RoomLocationAsync(roomId, t) ?? throw new PropertyException(404, "resource_not_found");
        var room = (await SnapshotAsync(location, true, [], t)).Rooms.SingleOrDefault(r => r.Room.Id == roomId)
            ?? throw new PropertyException(404, "resource_not_found");
        return await HandoverInventory(room, t);
    }

    public async Task<HandoverInventory> ConfirmNoAssetsAsync(Guid roomId, RoomNoAssetsConfirmation input, CancellationToken t)
    {
        var location = await RoomScope(roomId, true, t);
        return await Store.TransactionAsync(location, async () =>
        {
            var context = await HandoverContext(roomId, t);
            var current = await HandoverInventory(context, t);
            if (current.StateToken != input.StateToken) throw new PropertyException(409, "inventory_review_state_changed");
            if (context.Items.Length != 0 || context.Physical.Length != 0 || context.InvalidConfiguration)
                throw new PropertyException(409, "room_has_asset_requirements_or_inventory");
            var key = Key($"room-no-assets:{roomId:N}");
            var previous = await Store.GetAsync(key, "RoomNoAssets", t);
            await Store.SaveAsync(key, location, "RoomNoAssets", "Confirmed",
                new { roomId, baseline = EmptyInventoryBaseline(context), reason = Text(input.Reason, 2000) }, previous?.Version ?? 0, Actor, t);
            return await HandoverInventory(context, t);
        }, t);
    }

    public async Task MarkForReviewAsync(Guid roomId, Guid contractId, int version, Guid actor, CancellationToken t)
    {
        var location = await RoomScope(roomId, false, t);
        var key = Key($"handover-inventory-discrepancy:{roomId:N}:{contractId:N}:{version}");
        if (await Store.GetAsync(key, "HandoverInventoryDiscrepancy", t) is null)
            await Store.SaveAsync(key, location, "HandoverInventoryDiscrepancy", "NeedsReview", new { roomId, contractId, version }, 0, actor, t);
    }

    public async Task SynchronizeAsync(Guid roomId, Guid contractId, int version, HandoverSnapshot snapshot, Guid actor, CancellationToken t)
    {
        // Called only by the Owner review mutation, inside the existing Location/Room transaction.
        Owner();
        var current = await PrepareAsync(roomId, t);
        if (snapshot.InventoryToken is null || snapshot.InventoryToken != current.StateToken)
            throw ContractException.Conflict("handover_asset_inventory_changed");
        var seen = new HashSet<Guid>();
        foreach (var group in snapshot.Assets)
        {
            if (group.ObservedQuantity is null) continue; // Legacy text-only condition has no invented quantity.
            var physical = group.PhysicalAssets ?? [];
            if (physical.Length == 0)
            {
                if (group.ObservedQuantity != 0) throw ContractException.Conflict("asset_inventory_mapping_required");
                continue;
            }
            foreach (var expected in physical)
            {
                if (!seen.Add(expected.Id)) throw ContractException.Conflict("ambiguous_asset_inventory_mapping");
                var asset = await Store.AssetAsync(expected.Id, t) ?? throw ContractException.Conflict("handover_asset_inventory_changed");
                if (asset.RoomId != roomId || asset.Version != expected.Version) throw ContractException.Conflict("handover_asset_inventory_changed");
                var metadata = (await Store.AssetMetadataAsync([asset.Id], t))[asset.Id];
                var observed = physical.Length == 1 ? group.ObservedQuantity.Value :
                    group.PhysicalObservations?.SingleOrDefault(p => p.Id == asset.Id)?.Quantity
                    ?? throw ContractException.Invalid("physical_asset_quantities_required");
                var condition = group.PhysicalObservations?.SingleOrDefault(p => p.Id == asset.Id)?.Condition ?? group.ObservedCondition;
                var changed = observed != metadata.Quantity || condition != asset.Condition;
                if (!changed) continue;
                if (asset.Status != AssetStatus.Active || await Store.HasOpenAssetWorkAsync(asset.Id, t))
                    throw ContractException.Conflict("asset_workflow_controlled");
                if (metadata.TrackingMode == "Serialized" && observed > 1) throw ContractException.Invalid("serialized_asset_quantity_invalid");
                asset.Condition = condition;
                if (observed == 0) asset.Status = AssetStatus.Retired;
                asset.Version++;
                var reason = $"Owner confirmed move-out contract {contractId}, inspection v{version}, {snapshot.Date:yyyy-MM-dd}; observed quantity {observed}";
                await Store.SaveAssetAsync(asset, actor, reason, t);
                // Zero is represented through retirement; metadata's positive-quantity invariant is retained.
                if (observed > 0)
                {
                    var updated = metadata with { Quantity = observed };
                    await Store.SaveAssetMetadataAsync(asset.Id, updated, t);
                    var previous = await Store.GetAsync(asset.Id, "AssetMetadata", t);
                    await Store.SaveAsync(asset.Id, asset.LocationId, "AssetMetadata", "Recorded", new
                    {
                        updated.TrackingMode,
                        updated.Quantity,
                        updated.PurchaseCost,
                        updated.PurchaseDate,
                        updated.UsefulLifeMonths,
                        updated.Unit,
                        reason
                    }, previous?.Version ?? 0, actor, t);
                }
            }
        }
    }
}
