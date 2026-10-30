using BHome.Domain.Common;

namespace BHome.Domain.PropertyManagement;

public enum RoomStatus { Available, OnHold, Occupied, Unavailable }
public enum AssetStatus { Active, NeedsRepair, UnderRepair, Retired }
public enum ChargeCategory { Rent, Electricity, Water, ServiceFee }
public enum ChargingMethod { FixedPerRoomPerMonth, Metered }

public sealed class RoomType : AuditableEntity
{
    public Guid LocationId { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int DefaultCapacity { get; set; } = 1;
    public decimal? AreaM2 { get; set; }
    public string[] Amenities { get; set; } = [];
    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;
}

public sealed class Asset : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string? CommonArea { get; set; }
    public string? Code { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Condition { get; set; } = "";
    public AssetStatus Status { get; set; }
    public int Version { get; set; } = 1;
}

public sealed class BillingPolicy : AuditableEntity
{
    public Guid LocationId { get; set; }
    public Guid? RoomTypeId { get; set; }
    public Guid? RoomId { get; set; }
    public ChargeCategory Category { get; set; }
    public string ChargeCode { get; set; } = "";
    public string Name { get; set; } = "";
    public ChargingMethod Method { get; set; }
    public decimal Rate { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public DateTimeOffset? FirstUsedAt { get; private set; }
    public int Version { get; set; } = 1;

    // Billing must call this in the same transaction/Location lock as its policy snapshot.
    public void RecordUsage(DateTimeOffset usedAt)
    {
        if (usedAt == default) throw new ArgumentOutOfRangeException(nameof(usedAt));
        FirstUsedAt ??= usedAt.ToUniversalTime();
    }
}

// Configuration snapshots contain no resident identity or credentials. Inserts only.
public sealed class PropertyChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActorId { get; set; }
    public Guid? LocationId { get; set; }
    public Guid TargetId { get; set; }
    public string TargetType { get; set; } = "";
    public string Action { get; set; } = "";
    public string Reason { get; set; } = "";
    public string? Before { get; set; }
    public string After { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}

public static class PropertyRules
{
    public static string Normalize(string value) => value.Trim().ToUpperInvariant();

    public static bool CanManuallyChange(RoomStatus current, RoomStatus requested, bool hasResidents) =>
        requested is RoomStatus.Available or RoomStatus.Unavailable &&
        (current == requested || current is RoomStatus.Available or RoomStatus.Unavailable && !hasResidents);

    public static bool ValidCharge(ChargeCategory category, ChargingMethod method, string code) =>
        category switch
        {
            ChargeCategory.Rent => method == ChargingMethod.FixedPerRoomPerMonth && code == "RENT",
            ChargeCategory.Electricity => method == ChargingMethod.Metered && code == "ELECTRICITY",
            ChargeCategory.Water => method == ChargingMethod.Metered && code == "WATER",
            ChargeCategory.ServiceFee => method == ChargingMethod.FixedPerRoomPerMonth &&
                code is not ("RENT" or "ELECTRICITY" or "WATER"),
            _ => false
        };
}
