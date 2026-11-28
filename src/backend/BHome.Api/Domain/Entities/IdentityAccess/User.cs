using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("users", Schema = "public")]
public sealed class User
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("username", TypeName = "varchar(256)")]
    public string Username { get; set; } = null!;

    [Column("normalized_username", TypeName = "varchar(256)")]
    public string NormalizedUsername { get; set; } = null!;

    [Column("password_hash", TypeName = "text")]
    public string PasswordHash { get; set; } = null!;

    [Column("email", TypeName = "varchar(256)")]
    public string? Email { get; set; }

    [Column("normalized_email", TypeName = "varchar(256)")]
    public string? NormalizedEmail { get; set; }

    [Column("email_confirmed", TypeName = "boolean")]
    public bool EmailConfirmed { get; set; }

    [Column("phone", TypeName = "varchar(30)")]
    public string? Phone { get; set; }

    [Column("phone_confirmed", TypeName = "boolean")]
    public bool PhoneConfirmed { get; set; }

    [Column("full_name", TypeName = "varchar(150)")]
    public string? FullName { get; set; }

    [Column("roles", TypeName = "text[]")]
    public string[] Roles { get; set; } = null!;

    [Column("is_active", TypeName = "boolean")]
    public bool IsActive { get; set; }

    [Column("security_stamp", TypeName = "varchar(256)")]
    public string SecurityStamp { get; set; } = null!;

    [Column("concurrency_stamp", TypeName = "varchar(256)")]
    public string ConcurrencyStamp { get; set; } = null!;

    [Column("access_failed_count", TypeName = "integer")]
    public int AccessFailedCount { get; set; }

    [Column("lockout_enabled", TypeName = "boolean")]
    public bool LockoutEnabled { get; set; }

    [Column("lockout_end", TypeName = "timestamptz")]
    public DateTimeOffset? LockoutEnd { get; set; }

    [Column("two_factor_enabled", TypeName = "boolean")]
    public bool TwoFactorEnabled { get; set; }

    [Column("reset_token_hash", TypeName = "varchar(64)")]
    public string? ResetTokenHash { get; set; }

    [Column("reset_expires_at", TypeName = "timestamptz")]
    public DateTimeOffset? ResetExpiresAt { get; set; }

    [Column("reset_consumed_at", TypeName = "timestamptz")]
    public DateTimeOffset? ResetConsumedAt { get; set; }

    [Column("business_profile", TypeName = "jsonb")]
    public JsonElement BusinessProfile { get; set; }

    [Column("signing_credentials", TypeName = "jsonb")]
    public JsonElement SigningCredentials { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
