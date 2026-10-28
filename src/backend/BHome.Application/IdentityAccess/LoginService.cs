using BHome.Domain.IdentityAccess;

namespace BHome.Application.IdentityAccess;

public sealed record LoginResult(Guid UserId, IReadOnlyCollection<string> Roles, string AccessToken, DateTimeOffset ExpiresAt);

public sealed class LoginService(ICredentialVerifier credentials, IAccessTokenIssuer tokens)
{
    public const int MaxUserNameLength = 256;
    public const int MaxPasswordLength = 1024;

    public async Task<LoginResult?> LoginAsync(string? userName, string? password, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > MaxUserNameLength ||
            string.IsNullOrWhiteSpace(password) || password.Length > MaxPasswordLength)
            return null;

        var identity = await credentials.VerifyAsync(userName, password, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (identity is null || identity.UserId == Guid.Empty || identity.Roles.Count == 0 ||
            identity.Roles.Any(role => !Roles.All.Contains(role)))
            return null;

        var roles = identity.Roles.Distinct().ToArray();
        var token = tokens.Issue(identity.UserId, roles);
        return new LoginResult(identity.UserId, roles, token.Value, token.ExpiresAt);
    }
}
