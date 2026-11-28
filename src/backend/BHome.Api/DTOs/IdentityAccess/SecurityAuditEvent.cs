namespace BHome.Infrastructure.IdentityAccess;

// The v1 audit state is immutable JSON evidence, not a separate relational entity.
internal sealed record SecurityAuditEvent(Guid Id, Guid? UserId, Guid? TargetUserId, Guid? SessionId,
    string Event, bool Succeeded, DateTimeOffset OccurredAt, string? TargetType, Guid? TargetId);
