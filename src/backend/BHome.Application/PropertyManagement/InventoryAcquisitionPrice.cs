namespace BHome.Application.PropertyManagement;

/// <summary>
/// Pricing on an inventory attestation is a per-unit acquisition amount,
/// not a quantity adjustment or an instruction to revalue a posted purchase.
/// Null means unknown; explicit zero means an asset acquired without cost.
/// </summary>
internal static class InventoryAcquisitionPrice
{
    // Quantity is configured independently (up to 10,000). Keep the resulting
    // amount within Compact24 expenses.numeric(18,0) without rounding VND.
    internal const decimal MaxUnitCost = 99_999_999_999_999m;

    internal static bool Valid(decimal? value) => value is null ||
        value >= 0m && value <= MaxUnitCost && decimal.Truncate(value.Value) == value.Value;

    internal static bool ValidReference(decimal? value) => value is null ||
        value >= 0m && value <= 99_999_999_999_999.9999m && decimal.Round(value.Value, 4) == value.Value;

    internal static object MetadataSnapshot(AssetMetadata metadata) => new
    {
        metadata.TrackingMode, metadata.Quantity, metadata.PurchaseCost,
        metadata.PurchaseDate, metadata.UsefulLifeMonths, metadata.Unit,
        Reason = "Giá vốn xác nhận khi kiểm kê"
    };
}
