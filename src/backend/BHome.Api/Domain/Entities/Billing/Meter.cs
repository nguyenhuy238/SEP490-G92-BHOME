using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("meters", Schema = "public")]
public sealed class Meter
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid RoomId { get; set; }

    [Column("utility_type", TypeName = "smallint")]
    public short UtilityType { get; set; }

    [Column("meter_code", TypeName = "varchar(80)")]
    public string MeterCode { get; set; } = null!;

    [Column("display_type", TypeName = "smallint")]
    public short DisplayType { get; set; }

    [Column("decimal_places", TypeName = "smallint")]
    public short DecimalPlaces { get; set; }

    [Column("installed_on", TypeName = "date")]
    public DateOnly InstalledOn { get; set; }

    [Column("removed_on", TypeName = "date")]
    public DateOnly? RemovedOn { get; set; }

    [Column("previous_meter_id", TypeName = "uuid")]
    public Guid? PreviousMeterId { get; set; }

    [Column("is_active", TypeName = "boolean")]
    public bool IsActive { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
