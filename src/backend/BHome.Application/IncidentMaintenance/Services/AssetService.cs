using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// UC-05: Staff update the condition note of assets in their assigned Locations. Creating, editing and
// retiring assets belong to Property Management (/api/v1/assets); the repair status follows maintenance (A4).
public sealed class AssetService(IIncidentMaintenanceStore store, MaintenanceAccess access)
{
    public async Task<AssetSummary> UpdateConditionAsync(Guid id, AssetConditionInput input, CancellationToken cancellationToken)
    {
        MaintenanceAccess.Validate(input);
        var viewer = await access.ViewerAsync(Permissions.Assets.UpdateCondition, cancellationToken);
        var asset = await store.FindAssetAsync(id, cancellationToken);
        if (asset is null || !(viewer.IsOwner || viewer.StaffLocationIds.Contains(asset.LocationId)))
            throw new MaintenanceNotFoundException();

        asset.UpdateCondition(input.Condition);
        await store.SaveAsync(cancellationToken);
        return new AssetSummary(asset.Id, asset.LocationId, asset.RoomId, asset.CommonArea, asset.Code, asset.Name,
            asset.Category, asset.Condition, asset.Status, asset.Version);
    }
}
