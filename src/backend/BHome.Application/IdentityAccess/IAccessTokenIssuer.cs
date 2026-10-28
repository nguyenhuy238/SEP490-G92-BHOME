namespace BHome.Application.IdentityAccess;

public sealed record AccessToken(string Value, DateTimeOffset ExpiresAt);

// Only call after Identity verifies credentials and supplies stored roles. Never accept roles from clients.
public interface IAccessTokenIssuer
{
    AccessToken Issue(Guid userId, IReadOnlyCollection<string> roles);
}
