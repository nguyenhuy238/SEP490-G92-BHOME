namespace BHome.Application.IdentityAccess;

public sealed record SessionIdentity(Guid UserId, Guid SessionId, IReadOnlyCollection<string> Roles);

public interface IAuthenticationSessions
{
    Task<LoginResult?> CreateAsync(VerifiedIdentity identity, string? device, CancellationToken cancellationToken);
    Task<LoginResult?> RefreshAsync(string token, CancellationToken cancellationToken);
    Task RevokeAsync(Guid userId, Guid sessionId, bool allDevices, CancellationToken cancellationToken);
    Task<bool> ValidateAsync(SessionIdentity identity, string securityStamp, CancellationToken cancellationToken);
}

public interface ISecurityAudit
{
    Task LoginFailedAsync(CancellationToken cancellationToken);
    Task ForbiddenAsync(Guid? userId, Guid? sessionId, CancellationToken cancellationToken);
}

public interface IPasswordService
{
    Task<bool> ChangeAsync(Guid userId, Guid sessionId, string currentPassword, string newPassword, CancellationToken cancellationToken);
    Task RequestResetAsync(string userName, CancellationToken cancellationToken);
    Task<bool> ResetAsync(string userName, string token, string newPassword, CancellationToken cancellationToken);
}

// A real, reviewed delivery adapter must be provided before enabling forgot-password.
public interface IPasswordResetDelivery
{
    bool IsAvailable { get; }
    // Durable adapters validate callbacks independently of SMTP readiness and other operations.
    bool IsAvailableFor(string kind) => IsAvailable;
    bool IsDurable => false;
    // Owner invitations may report destination policy before issuing a grant.
    // Public password recovery retains its generic response and must not call this preflight.
    void ValidateInvitationRecipient(string destination) { }
    // Called inside the grant transaction before account lookup, including unknown identifiers.
    Task EnsureQueueWritableAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken);
    Task QueueAsync(AuthenticationEmailRequest request, CancellationToken cancellationToken) =>
        SendAsync(request.UserId, request.Destination, request.Token, cancellationToken);
}

public sealed record AuthenticationEmailRequest(Guid UserId, string Destination, string Token, DateTimeOffset ExpiresAt,
    string Kind = "PasswordReset");
