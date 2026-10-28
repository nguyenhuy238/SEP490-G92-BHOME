using System.ComponentModel.DataAnnotations;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.IdentityAccess;

public sealed record LoginResult(Guid UserId, IReadOnlyCollection<string> Roles, string AccessToken, DateTimeOffset ExpiresAt,
    Guid SessionId, string? RefreshToken, DateTimeOffset SessionExpiresAt);

public sealed class LoginService(ICredentialVerifier credentials, IAuthenticationSessions sessions, ISecurityAudit audit)
{
    public const int MaxUserNameLength = 256;
    public const int MaxEmailLength = 256;
    public const int MaxPasswordLength = 1024;

    public async Task<LoginResult?> LoginAsync(string? email, string? password, CancellationToken cancellationToken = default,
        string? device = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(email) || email.Length > MaxEmailLength ||
            !new EmailAddressAttribute().IsValid(email.Trim()) ||
            string.IsNullOrWhiteSpace(password) || password.Length > MaxPasswordLength)
        {
            await audit.LoginFailedAsync(cancellationToken);
            return null;
        }

        var identity = await credentials.VerifyAsync(email.Trim(), password, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (identity is null || identity.UserId == Guid.Empty || identity.Roles.Count == 0 ||
            identity.Roles.Any(role => !Roles.All.Contains(role)))
        {
            await audit.LoginFailedAsync(cancellationToken);
            return null;
        }

        return await sessions.CreateAsync(identity, device, cancellationToken);
    }
}
