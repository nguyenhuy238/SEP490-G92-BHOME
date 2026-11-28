using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BHome.Domain.Entities;

[Table("refresh_tokens", Schema = "public")]
public sealed class RefreshToken
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("user_id", TypeName = "uuid")]
    public Guid UserId { get; set; }

    [Column("record_kind", TypeName = "varchar(10)")]
    public string RecordKind { get; set; } = null!;

    [Column("session_id", TypeName = "uuid")]
    public Guid? SessionId { get; set; }

    [Column("token_hash", TypeName = "varchar(64)")]
    public string? TokenHash { get; set; }

    [Column("security_stamp", TypeName = "varchar(256)")]
    public string? SecurityStamp { get; set; }

    [Column("device_label", TypeName = "varchar(256)")]
    public string? DeviceLabel { get; set; }

    [Column("issued_at", TypeName = "timestamptz")]
    public DateTimeOffset IssuedAt { get; set; }

    [Column("last_activity_at", TypeName = "timestamptz")]
    public DateTimeOffset? LastActivityAt { get; set; }

    [Column("expires_at", TypeName = "timestamptz")]
    public DateTimeOffset ExpiresAt { get; set; }

    [Column("consumed_at", TypeName = "timestamptz")]
    public DateTimeOffset? ConsumedAt { get; set; }

    [Column("revoked_at", TypeName = "timestamptz")]
    public DateTimeOffset? RevokedAt { get; set; }

    [Column("revocation_reason", TypeName = "varchar(50)")]
    public string? RevocationReason { get; set; }

    [Column("replaced_by_token_id", TypeName = "uuid")]
    public Guid? ReplacedByTokenId { get; set; }
}
