using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

// One meter entity for business code and the physical meters table.
public sealed class Meter : AuditableEntity
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    [NotMapped, JsonIgnore] public string MeterCode { get; set; } = "";
    public string Code { get => MeterCode; set => MeterCode = value; }
    public UtilityType UtilityType { get; set; }
    [NotMapped, JsonIgnore] public MeterDisplay DisplayType { get; set; }
    public MeterDisplay Display { get => DisplayType; set => DisplayType = value; }
    public int DecimalPlaces { get; set; }
    public bool IsActive { get; set; } = true;
    public DateOnly InstalledOn { get; set; }

    // Storage-only members are explicitly mapped by the physical EF model.
    [NotMapped, JsonIgnore] public DateOnly? RemovedOn { get; set; }
    [NotMapped, JsonIgnore] public Guid? PreviousMeterId { get; set; }
    private JsonElement history = MeterHistory.Empty;
    [NotMapped, JsonIgnore]
    public JsonElement History
    {
        get => history;
        set
        {
            history = value;
            var state = MeterHistory.Latest(value, "Meter");
            CreatedAt = state?.CreatedAt ?? DateTimeOffset.UnixEpoch;
            UpdatedAt = state?.UpdatedAt ?? DateTimeOffset.UnixEpoch;
        }
    }
}
