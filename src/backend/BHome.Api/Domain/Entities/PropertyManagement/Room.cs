using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("rooms", Schema = "public")]
public sealed class Room
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_number", TypeName = "varchar(50)")]
    public string RoomNumber { get; set; } = null!;

    [Column("floor", TypeName = "varchar(30)")]
    public string? Floor { get; set; }

    [Column("capacity", TypeName = "smallint")]
    public short Capacity { get; set; }

    [Column("status", TypeName = "smallint")]
    public short Status { get; set; }

    [Column("billing_representatives", TypeName = "jsonb")]
    public JsonElement BillingRepresentatives { get; set; }

    [Column("public_profile", TypeName = "jsonb")]
    public JsonElement PublicProfile { get; set; }

    [Column("published_at", TypeName = "timestamptz")]
    public DateTimeOffset? PublishedAt { get; set; }

    [Column("published_by_user_id", TypeName = "uuid")]
    public Guid? PublishedByUserId { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
