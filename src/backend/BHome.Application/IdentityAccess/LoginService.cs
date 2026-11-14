using BHome.Domain.IdentityAccess;

namespace BHome.Application.IdentityAccess;

public sealed record LoginResult(Guid UserId, IReadOnlyCollection<string> Roles, string AccessToken, DateTimeOffset ExpiresAt,
    Guid SessionId, string? RefreshToken, DateTimeOffset SessionExpiresAt);

public sealed class LoginService(ICredentialVerifier credentials, IAuthenticationSessions sessions, ISecurityAudit audit)
{
    public const int MaxUserNameLength = 256;
    public const int MaxEmailLength = 256;
    public const int MaxPasswordLength = 1024;
    public const string InvalidCredentialsMessage = "Email, số điện thoại hoặc mật khẩu không chính xác. Vui lòng kiểm tra và thử lại.";

    public async Task<LoginResult?> LoginAsync(string? identifier, string? password, CancellationToken cancellationToken = default,
        string? device = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalizedIdentifier = Normalize(identifier);
        if (normalizedIdentifier is null ||
            string.IsNullOrWhiteSpace(password) || password.Length > MaxPasswordLength)
        {
            await audit.LoginFailedAsync(cancellationToken);
            return null;
        }

        var identity = await credentials.VerifyAsync(normalizedIdentifier, password, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (identity is null || identity.UserId == Guid.Empty || identity.Roles.Count == 0 ||
            identity.Roles.Any(role => !Roles.All.Contains(role)))
        {
            await audit.LoginFailedAsync(cancellationToken);
            return null;
        }

        return await sessions.CreateAsync(identity, device, cancellationToken);
    }

    private static string? Normalize(string? identifier)
    {
        if (string.IsNullOrWhiteSpace(identifier) || identifier.Length > MaxEmailLength) return null;
        var value = identifier.Trim();
        if (LoginIdentifier.IsEmail(value)) return value;
        return LoginIdentifier.NormalizePhone(value);
    }
}
