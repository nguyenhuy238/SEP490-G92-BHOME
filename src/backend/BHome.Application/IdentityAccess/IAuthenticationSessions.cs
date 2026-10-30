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
    Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken);
}
