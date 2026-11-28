namespace BHome.Infrastructure.IdentityAccess;

public sealed class AuthenticationSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string SecurityStamp { get; set; } = "";
    public string? Device { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastActivityAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevocationReason { get; set; }
}

public sealed class RefreshTokenRecord
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
}

public sealed class PasswordResetGrant
{
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
}

public sealed class SecurityAuditRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public Guid? TargetUserId { get; set; }
    public Guid? SessionId { get; set; }
    public string Event { get; set; } = "";
    public bool Succeeded { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public string? TargetType { get; set; }
    public Guid? TargetId { get; set; }
}
