using System.Security.Cryptography;
using System.Text;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;

namespace BHome.Infrastructure.IdentityAccess;

// Every mutating session/password operation takes the same user-row lock inside its transaction.
// This works across API instances; there is no in-process rotation lock or revocation cache.
internal sealed class IdentitySecurityStore(IIdentityPersistence db, TimeProvider clock)
{
    public async Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken cancellationToken)
        => await db.LockUserAsync(userId, cancellationToken);

    public bool IsEligible(ApplicationUser user) => user.IsActive && !user.TwoFactorEnabled &&
        (!user.LockoutEnabled || user.LockoutEnd is null || user.LockoutEnd <= clock.GetUtcNow()) &&
        !string.IsNullOrWhiteSpace(user.SecurityStamp);

    public async Task<string[]> RolesAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.RolesAsync(userId, cancellationToken);

    public static bool SupportedRoles(IReadOnlyCollection<string> roles) =>
        roles.Count > 0 && roles.All(Roles.All.Contains);

    public void Audit(string name, bool succeeded, Guid? userId = null, Guid? sessionId = null) =>
        db.Audit(new SecurityAuditRecord
        {
            Event = name,
            Succeeded = succeeded,
            UserId = userId,
            TargetUserId = userId,
            SessionId = sessionId,
            OccurredAt = clock.GetUtcNow()
        });

    public async Task RevokeAllAsync(Guid userId, string reason, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await db.RevokeAllAsync(userId, reason, now, cancellationToken);
    }

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
