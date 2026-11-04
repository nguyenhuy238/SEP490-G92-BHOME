using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class LegacyIdentityPersistence(BHomeDbContext db) : IIdentityPersistence
{
    public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken token) => db.Database.BeginTransactionAsync(token);
    public Task<int> SaveChangesAsync(CancellationToken token) => db.SaveChangesAsync(token);
    public async Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("An auth transaction is required.");
        var current = await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {userId} FOR UPDATE")
            .AsNoTracking().SingleOrDefaultAsync(token);
        if (current is null) return null;
        var tracked = db.Users.Local.SingleOrDefault(x => x.Id == userId);
        if (tracked is null) { db.Attach(current); return current; }
        db.Entry(tracked).CurrentValues.SetValues(current);
        return tracked;
    }
    public Task<string[]> RolesAsync(Guid userId, CancellationToken token) =>
        (from assignment in db.UserRoles
         join role in db.Roles on assignment.RoleId equals role.Id
         where assignment.UserId == userId && role.Name != null
         select role.Name!).Distinct().ToArrayAsync(token);
    public void Audit(SecurityAuditRecord record) => db.SecurityAudit.Add(record);
    public Task RevokeAllAsync(Guid userId, string reason, DateTimeOffset now, CancellationToken token) =>
        db.AuthenticationSessions.Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevocationReason, reason), token);
    public Task<Guid?> TokenOwnerAsync(string hash, CancellationToken token) =>
        (from refresh in db.RefreshTokens
         join session in db.AuthenticationSessions on refresh.SessionId equals session.Id
         where refresh.TokenHash == hash
         select (Guid?)session.UserId).SingleOrDefaultAsync(token);
    public async Task<RefreshTokenRecord> TokenAsync(string hash, CancellationToken token)
    {
        var stored = await db.RefreshTokens.SingleAsync(x => x.TokenHash == hash, token);
        await db.Entry(stored).ReloadAsync(token);
        return stored;
    }
    public async Task<AuthenticationSession?> SessionAsync(Guid id, Guid? userId, CancellationToken token)
    {
        var stored = await db.AuthenticationSessions.SingleOrDefaultAsync(x => x.Id == id && (userId == null || x.UserId == userId), token);
        if (stored is not null) await db.Entry(stored).ReloadAsync(token);
        return stored;
    }
    public void AddSession(AuthenticationSession session) => db.AuthenticationSessions.Add(session);
    public void AddToken(RefreshTokenRecord refresh) => db.RefreshTokens.Add(refresh);
    public Guid IssuedTokenId(string hash) => db.RefreshTokens.Local.Single(x => x.TokenHash == hash).Id;
    public Task<bool> ValidSessionAsync(SessionIdentity identity, string stamp, DateTimeOffset now, CancellationToken token) =>
        (from session in db.AuthenticationSessions.AsNoTracking()
         join user in db.Users.AsNoTracking() on session.UserId equals user.Id
         where session.Id == identity.SessionId && user.Id == identity.UserId && user.IsActive && !user.TwoFactorEnabled &&
             (!user.LockoutEnabled || user.LockoutEnd == null || user.LockoutEnd <= now) && session.RevokedAt == null &&
             session.ExpiresAt > now && session.SecurityStamp == stamp && user.SecurityStamp == stamp
         select session.Id).AnyAsync(token);
    public Task<int> TouchSessionAsync(Guid id, DateTimeOffset now, CancellationToken token) =>
        db.AuthenticationSessions.Where(x => x.Id == id && x.RevokedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.LastActivityAt, x => x.LastActivityAt > now ? x.LastActivityAt : now), token);
    public Task<bool> CurrentSessionAsync(Guid userId, Guid sessionId, string? stamp, DateTimeOffset now, CancellationToken token) =>
        db.AuthenticationSessions.AnyAsync(x => x.Id == sessionId && x.UserId == userId && x.RevokedAt == null &&
            x.ExpiresAt > now && x.SecurityStamp == stamp, token);
    public Task<PasswordResetGrant?> ResetGrantAsync(Guid userId, CancellationToken token) => db.PasswordResetGrants.SingleOrDefaultAsync(x => x.UserId == userId, token);
    public void AddResetGrant(PasswordResetGrant grant) => db.PasswordResetGrants.Add(grant);
    public Task ConsumeResetGrantsAsync(Guid userId, DateTimeOffset now, CancellationToken token) =>
        db.PasswordResetGrants.Where(x => x.UserId == userId && x.ConsumedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.ConsumedAt, now), token);
}
