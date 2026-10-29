using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-05: the Owner manages assets; Staff only update the condition note in assigned Locations.
// The status (Needs Repair / Under Repair / Active) is changed by the maintenance flow (UC-05 A4).
public sealed class AssetService(IIncidentMaintenanceStore store, MaintenanceAccess access)
{
    public async Task<IReadOnlyList<AssetSummary>> ListAsync(AssetListQuery query, CancellationToken cancellationToken)
    {
        var viewer = await access.ViewerAsync(Permissions.Assets.View, cancellationToken);
        return await store.ListAssetsAsync(viewer, query with { Take = Math.Clamp(query.Take, 1, 200) }, cancellationToken);
    }

    public async Task<AssetSummary> CreateAsync(CreateAssetInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Assets.Manage);
        if (!await store.LocationExistsAsync(input.LocationId, cancellationToken)) throw new MaintenanceNotFoundException();
        await EnsureRoomInLocationAsync(input.RoomId, input.LocationId, cancellationToken);
        await EnsureCodeIsFreeAsync(input.LocationId, input.AssetCode, null, cancellationToken);

        var asset = new Asset(input.LocationId, input.RoomId, input.AssetCode, input.Name, input.Category, input.PurchaseInfo);
        store.Add(asset);
        store.Audit(owner, "AssetCreated", "Asset", asset.Id);
        await store.SaveAsync(cancellationToken);
        return ToSummary(asset);
    }

    public async Task<AssetSummary> UpdateAsync(Guid id, UpdateAssetInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var owner = access.RequireOwner(Permissions.Assets.Manage);
        var asset = await store.FindAssetAsync(id, cancellationToken) ?? throw new MaintenanceNotFoundException();
        await EnsureRoomInLocationAsync(input.RoomId, asset.LocationId, cancellationToken);
        await EnsureCodeIsFreeAsync(asset.LocationId, input.AssetCode, asset.Id, cancellationToken);

        asset.UpdateDetails(input.AssetCode, input.Name, input.Category, input.PurchaseInfo);
        asset.AssignTo(input.RoomId);
        store.Audit(owner, "AssetUpdated", "Asset", asset.Id);
        await store.SaveAsync(cancellationToken);
        return ToSummary(asset);
    }

    // UC-05 A3: retire instead of delete; not allowed while a Work Order is still open.
    public async Task<AssetSummary> RetireAsync(Guid id, CancellationToken cancellationToken)
    {
        var owner = access.RequireOwner(Permissions.Assets.Manage);
        var asset = await store.FindAssetAsync(id, cancellationToken) ?? throw new MaintenanceNotFoundException();

        asset.Retire(await store.HasOpenWorkOrdersForAssetAsync(id, null, cancellationToken));
        store.Audit(owner, "AssetRetired", "Asset", asset.Id);
        await store.SaveAsync(cancellationToken);
        return ToSummary(asset);
    }

    public async Task<AssetSummary> UpdateConditionAsync(Guid id, AssetConditionInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var viewer = await access.ViewerAsync(Permissions.Assets.UpdateCondition, cancellationToken);
        var asset = await store.FindAssetAsync(id, cancellationToken);
        if (asset is null || !(viewer.IsOwner || viewer.StaffLocationIds.Contains(asset.LocationId)))
            throw new MaintenanceNotFoundException();

        asset.UpdateCondition(input.Condition);
        await store.SaveAsync(cancellationToken);
        return ToSummary(asset);
    }

    private async Task EnsureRoomInLocationAsync(Guid? roomId, Guid locationId, CancellationToken cancellationToken)
    {
        if (roomId is not { } id) return;
        var room = await store.FindRoomAsync(id, cancellationToken);
        if (room?.LocationId != locationId) throw new MaintenanceValidationException("room_not_in_location");
    }

    private async Task EnsureCodeIsFreeAsync(Guid locationId, string code, Guid? assetId, CancellationToken cancellationToken)
    {
        if (await store.AssetCodeExistsAsync(locationId, code.Trim(), assetId, cancellationToken))
            throw new MaintenanceStateException("asset_code_exists");
    }

    private static AssetSummary ToSummary(Asset a) =>
        new(a.Id, a.LocationId, a.RoomId, a.AssetCode, a.Name, a.Category, a.PurchaseInfo, a.Condition, a.Status);
}
