using BHome.Domain.PropertyManagement;

namespace BHome.Domain.IncidentMaintenance;

// UC-05 A4: the maintenance flow owns the repair status of an Asset (Property Management owns the record).
// Each change bumps Version so a stale Owner edit of the same Asset gets a conflict.
public static class AssetRepairStatus
{
    public static void MarkNeedsRepair(this Asset asset)
    {
        EnsureNotRetired(asset);
        if (asset.Status == AssetStatus.Active) Set(asset, AssetStatus.NeedsRepair);
    }

    public static void MarkUnderRepair(this Asset asset)
    {
        EnsureNotRetired(asset);
        if (asset.Status != AssetStatus.UnderRepair) Set(asset, AssetStatus.UnderRepair);
    }

    // D10: callers pass whether any other Work Order on this Asset is still open.
    public static void CompleteRepair(this Asset asset, bool otherOpenWorkOrders)
    {
        if (asset.Status is AssetStatus.Retired or AssetStatus.Active || otherOpenWorkOrders) return;
        Set(asset, AssetStatus.Active);
    }

    // Staff note on the asset's physical condition (UC-05); the status stays with the maintenance flow.
    public static void UpdateCondition(this Asset asset, string condition)
    {
        EnsureNotRetired(asset);
        asset.Condition = Rules.Text(condition, 1000, "condition_required");
        asset.Version++;
    }

    private static void Set(Asset asset, AssetStatus status)
    {
        asset.Status = status;
        asset.Version++;
    }

    private static void EnsureNotRetired(Asset asset)
    {
        if (asset.Status == AssetStatus.Retired) throw new MaintenanceStateException("asset_retired");
    }
}
