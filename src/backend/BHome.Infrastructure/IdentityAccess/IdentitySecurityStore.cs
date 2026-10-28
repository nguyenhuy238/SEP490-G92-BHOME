using System.Security.Cryptography;
using System.Text;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

// Every mutating session/password operation takes the same user-row lock inside its transaction.
// This works across API instances; there is no in-process rotation lock or revocation cache.
internal sealed class IdentitySecurityStore(BHomeDbContext db, TimeProvider clock)
{
    public async Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("An auth transaction is required.");
        var current = await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {userId} FOR UPDATE")
            .AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (current is null) return null;
        var tracked = db.Users.Local.SingleOrDefault(x => x.Id == userId);
        if (tracked is null) { db.Attach(current); return current; }
        db.Entry(tracked).CurrentValues.SetValues(current);
        return tracked;
    }

    public bool IsEligible(ApplicationUser user) => user.IsActive && !user.TwoFactorEnabled &&
        (!user.LockoutEnabled || user.LockoutEnd is null || user.LockoutEnd <= clock.GetUtcNow()) &&
        !string.IsNullOrWhiteSpace(user.SecurityStamp);

    public async Task<string[]> RolesAsync(Guid userId, CancellationToken cancellationToken) =>
        await (from assignment in db.UserRoles
               join role in db.Roles on assignment.RoleId equals role.Id
               where assignment.UserId == userId && role.Name != null
               select role.Name!).Distinct().ToArrayAsync(cancellationToken);

    public static bool SupportedRoles(IReadOnlyCollection<string> roles) =>
        roles.Count > 0 && roles.All(Roles.All.Contains);

    public void Audit(string name, bool succeeded, Guid? userId = null, Guid? sessionId = null) =>
        db.SecurityAudit.Add(new SecurityAuditRecord
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
        await db.AuthenticationSessions.Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.RevokedAt, now)
                .SetProperty(x => x.RevocationReason, reason), cancellationToken);
    }

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
