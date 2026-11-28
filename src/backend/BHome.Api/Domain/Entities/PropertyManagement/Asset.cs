using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("assets", Schema = "public")]
public sealed class Asset
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid? RoomId { get; set; }

    [Column("common_area", TypeName = "varchar(200)")]
    public string? CommonArea { get; set; }

    [Column("asset_code", TypeName = "varchar(80)")]
    public string? AssetCode { get; set; }

    [Column("name", TypeName = "varchar(150)")]
    public string Name { get; set; } = null!;

    [Column("category", TypeName = "varchar(80)")]
    public string Category { get; set; } = null!;

    [Column("condition", TypeName = "text")]
    public string Condition { get; set; } = null!;

    [Column("status", TypeName = "smallint")]
    public short Status { get; set; }

    [Column("purchase_info", TypeName = "jsonb")]
    public JsonElement PurchaseInfo { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
