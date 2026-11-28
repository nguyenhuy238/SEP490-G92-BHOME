using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("residents", Schema = "public")]
public sealed class Resident
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("user_id", TypeName = "uuid")]
    public Guid? UserId { get; set; }

    [Column("contact_email", TypeName = "varchar(256)")]
    public string? ContactEmail { get; set; }

    [Column("current_room_id", TypeName = "uuid")]
    public Guid? CurrentRoomId { get; set; }

    [Column("identity_owner_scope_id", TypeName = "uuid")]
    public Guid IdentityOwnerScopeId { get; set; }

    [Column("display_label", TypeName = "varchar(150)")]
    public string DisplayLabel { get; set; } = null!;

    [Column("identity_data", TypeName = "jsonb")]
    public JsonElement IdentityData { get; set; }

    [Column("identity_hmac", TypeName = "varchar(64)")]
    public string? IdentityHmac { get; set; }

    [Column("hmac_key_version", TypeName = "varchar(32)")]
    public string? HmacKeyVersion { get; set; }

    [Column("verification_status", TypeName = "smallint")]
    public short VerificationStatus { get; set; }

    [Column("verified_by_user_id", TypeName = "uuid")]
    public Guid? VerifiedByUserId { get; set; }

    [Column("verified_at", TypeName = "timestamptz")]
    public DateTimeOffset? VerifiedAt { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
