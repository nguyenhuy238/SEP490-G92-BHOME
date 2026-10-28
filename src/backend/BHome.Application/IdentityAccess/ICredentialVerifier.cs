namespace BHome.Application.IdentityAccess;

public sealed record VerifiedIdentity(Guid UserId, IReadOnlyCollection<string> Roles);

public interface ICredentialVerifier
{
    // Return only an Identity-verified account with roles loaded from persistence.
    // Invalid credentials, lockout and unsupported sign-in requirements return null.
    Task<VerifiedIdentity?> VerifyAsync(string userName, string password, CancellationToken cancellationToken);
}
