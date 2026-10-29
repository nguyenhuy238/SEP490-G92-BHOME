using BHome.Domain.Common;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Domain.PropertyManagement;

public enum AssetStatus { Active, NeedsRepair, UnderRepair, Retired }

// UC-05: Owner manages; Staff only updates the condition note. Maintenance owns the status (A4).
public sealed class Asset : AuditableEntity
{
    private Asset() { }

    public Asset(Guid locationId, Guid? roomId, string assetCode, string name, string category, string? purchaseInfo)
    {
        if (locationId == Guid.Empty) throw new MaintenanceValidationException("location_required");
        LocationId = locationId;
        RoomId = roomId;
        UpdateDetails(assetCode, name, category, purchaseInfo);
    }

    public Guid LocationId { get; private set; }
    public Guid? RoomId { get; private set; }
    public string AssetCode { get; private set; } = "";
    public string Name { get; private set; } = "";
    public string Category { get; private set; } = "";
    public string? PurchaseInfo { get; private set; }
    public string? Condition { get; private set; }
    public AssetStatus Status { get; private set; } = AssetStatus.Active;
    public uint RowVersion { get; private set; }

    public void UpdateDetails(string assetCode, string name, string category, string? purchaseInfo)
    {
        EnsureNotRetired();
        AssetCode = Rules.Text(assetCode, 50, "asset_code_required");
        Name = Rules.Text(name, 150, "asset_name_required");
        Category = Rules.Text(category, 50, "asset_category_required");
        PurchaseInfo = Rules.OptionalText(purchaseInfo, 1000, "purchase_info_too_long");
    }

    // The application verifies the Room belongs to this Location; null means a common area.
    public void AssignTo(Guid? roomId)
    {
        EnsureNotRetired();
        RoomId = roomId;
    }

    public void UpdateCondition(string condition)
    {
        EnsureNotRetired();
        Condition = Rules.Text(condition, 1000, "condition_required");
    }

    public void MarkNeedsRepair()
    {
        EnsureNotRetired();
        if (Status == AssetStatus.Active) Status = AssetStatus.NeedsRepair;
    }

    public void MarkUnderRepair()
    {
        EnsureNotRetired();
        Status = AssetStatus.UnderRepair;
    }

    // D10: callers pass whether any other Work Order on this Asset is still open.
    public void CompleteRepair(bool otherOpenWorkOrders)
    {
        if (Status == AssetStatus.Retired || otherOpenWorkOrders) return;
        Status = AssetStatus.Active;
    }

    // UC-05 A3: assets with maintenance history are retired, never deleted.
    public void Retire(bool hasOpenWorkOrders)
    {
        if (Status == AssetStatus.Retired) throw new MaintenanceStateException("asset_retired");
        if (hasOpenWorkOrders) throw new MaintenanceStateException("asset_has_open_work_orders");
        Status = AssetStatus.Retired;
    }

    private void EnsureNotRetired()
    {
        if (Status == AssetStatus.Retired) throw new MaintenanceStateException("asset_retired");
    }
}
