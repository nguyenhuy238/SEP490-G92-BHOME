using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

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
    [NotMapped, JsonIgnore] public JsonElement Parameters { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());

    // Billing must call this in the same transaction/Location lock as its policy snapshot.
    public void RecordUsage(DateTimeOffset usedAt)
    {
        if (usedAt == default) throw new ArgumentOutOfRangeException(nameof(usedAt));
        FirstUsedAt ??= usedAt.ToUniversalTime();
    }
}
