using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("locations", Schema = "public")]
public sealed class Location
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("name", TypeName = "varchar(200)")]
    public string Name { get; set; } = null!;

    [Column("address", TypeName = "text")]
    public string Address { get; set; } = null!;

    [Column("is_active", TypeName = "boolean")]
    public bool IsActive { get; set; }

    [Column("staff_assignments", TypeName = "jsonb")]
    public JsonElement StaffAssignments { get; set; }

    [Column("operating_settings", TypeName = "jsonb")]
    public JsonElement OperatingSettings { get; set; }

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
