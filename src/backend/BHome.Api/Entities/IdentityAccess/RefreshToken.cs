namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string RecordKind { get; set; } = "";
    public Guid? SessionId { get; set; }
    public string? TokenHash { get; set; }
    public string? SecurityStamp { get; set; }
    public string? DeviceLabel { get; set; }
    public DateTimeOffset IssuedAt { get; set; }
    public DateTimeOffset? LastActivityAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevocationReason { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
}
