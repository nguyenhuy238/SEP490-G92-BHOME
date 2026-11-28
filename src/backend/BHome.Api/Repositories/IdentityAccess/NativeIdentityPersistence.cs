using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace BHome.Infrastructure.IdentityAccess;

// The physical users and refresh_tokens mappings are the only account/session storage.
internal sealed class NativeIdentityPersistence(Compact24DbContext db) : IIdentityPersistence
{
    private readonly Dictionary<Guid, AuthenticationSession> sessions = [];
    private readonly Dictionary<Guid, RefreshTokenRecord> tokens = [];
    private readonly Dictionary<Guid, PasswordResetGrant> grants = [];
    private readonly List<SecurityAuditRecord> audit = [];

    public async Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken token)
    {
        var transaction = await db.Database.BeginTransactionAsync(token);
        // A completed or abandoned unit of work cannot replay mutable DTO state.
        sessions.Clear(); tokens.Clear(); grants.Clear(); audit.Clear();
        return transaction;
    }
    public async Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("An auth transaction is required.");
        // Reload shadow state too (roles/reset grant), not just CLR properties after the row lock.
        var locked = await db.Users.FromSqlInterpolated($"SELECT * FROM users WHERE id={userId} FOR UPDATE").AsNoTracking().SingleOrDefaultAsync(token);
        if (locked is null) return null;
        var tracked = await db.Users.FindAsync([userId], token);
        await db.Entry(tracked!).ReloadAsync(token);
        return tracked;
    }
    public async Task<string[]> RolesAsync(Guid userId, CancellationToken token) =>
        await db.Users.AsNoTracking().Where(x => x.Id == userId).Select(x => EF.Property<string[]>(x, "roles")).SingleOrDefaultAsync(token) ?? [];
    public void Audit(SecurityAuditRecord record) => audit.Add(record);
    public Task RevokeAllAsync(Guid userId, string reason, DateTimeOffset now, CancellationToken token) =>
        db.Set<CompactRefreshRow>().Where(x => x.RecordKind == "SESSION" && x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevocationReason, reason), token);
    public Task<Guid?> TokenOwnerAsync(string hash, CancellationToken token) => db.Set<CompactRefreshRow>().AsNoTracking()
        .Where(x => x.RecordKind == "TOKEN" && x.TokenHash == hash).Select(x => (Guid?)x.UserId).SingleOrDefaultAsync(token);
    public async Task<RefreshTokenRecord> TokenAsync(string hash, CancellationToken token)
    {
        var row = await db.Set<CompactRefreshRow>().SingleAsync(x => x.RecordKind == "TOKEN" && x.TokenHash == hash, token);
        await db.Entry(row).ReloadAsync(token);
        var value = new RefreshTokenRecord
        {
            Id = row.Id,
            SessionId = row.SessionId!.Value,
            TokenHash = row.TokenHash!,
            CreatedAt = row.IssuedAt,
            ExpiresAt = row.ExpiresAt,
            ConsumedAt = row.ConsumedAt,
            ReplacedByTokenId = row.ReplacedByTokenId
        };
        tokens[row.Id] = value;
        return value;
    }
    public async Task<AuthenticationSession?> SessionAsync(Guid id, Guid? userId, CancellationToken token)
    {
        var row = await db.Set<CompactRefreshRow>().SingleOrDefaultAsync(x => x.Id == id && x.RecordKind == "SESSION" && (userId == null || x.UserId == userId), token);
        if (row is null) return null;
        await db.Entry(row).ReloadAsync(token);
        var value = new AuthenticationSession
        {
            Id = row.Id,
            UserId = row.UserId,
            SecurityStamp = row.SecurityStamp!,
            Device = row.DeviceLabel,
            CreatedAt = row.IssuedAt,
            LastActivityAt = row.LastActivityAt ?? row.IssuedAt,
            ExpiresAt = row.ExpiresAt,
            RevokedAt = row.RevokedAt,
            RevocationReason = row.RevocationReason
        };
        sessions[id] = value;
        return value;
    }
    public void AddSession(AuthenticationSession session)
    {
        sessions.Add(session.Id, session);
        db.Set<CompactRefreshRow>().Add(new CompactRefreshRow { Id = session.Id, UserId = session.UserId, RecordKind = "SESSION" });
    }
    public void AddToken(RefreshTokenRecord refresh)
    {
        var parent = db.Set<CompactRefreshRow>().Local.Single(x => x.Id == refresh.SessionId && x.RecordKind == "SESSION");
        tokens.Add(refresh.Id, refresh);
        db.Set<CompactRefreshRow>().Add(new CompactRefreshRow { Id = refresh.Id, UserId = parent.UserId, RecordKind = "TOKEN", SessionId = refresh.SessionId });
    }
    public Guid IssuedTokenId(string hash) => tokens.Values.Single(x => x.TokenHash == hash).Id;
    public Task<bool> ValidSessionAsync(SessionIdentity identity, string stamp, DateTimeOffset now, CancellationToken token) =>
        (from session in db.Set<CompactRefreshRow>().AsNoTracking()
         join user in db.Users.AsNoTracking() on session.UserId equals user.Id
         where session.Id == identity.SessionId && session.RecordKind == "SESSION" && user.Id == identity.UserId && user.IsActive &&
             !user.TwoFactorEnabled && (!user.LockoutEnabled || user.LockoutEnd == null || user.LockoutEnd <= now) &&
             session.RevokedAt == null && session.ExpiresAt > now && session.SecurityStamp == stamp && user.SecurityStamp == stamp
         select session.Id).AnyAsync(token);
    public Task<int> TouchSessionAsync(Guid id, DateTimeOffset now, CancellationToken token) =>
        db.Set<CompactRefreshRow>().Where(x => x.Id == id && x.RecordKind == "SESSION" && x.RevokedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.LastActivityAt, x => x.LastActivityAt > now ? x.LastActivityAt : now), token);
    public Task<bool> CurrentSessionAsync(Guid userId, Guid sessionId, string? stamp, DateTimeOffset now, CancellationToken token) =>
        db.Set<CompactRefreshRow>().AnyAsync(x => x.Id == sessionId && x.RecordKind == "SESSION" && x.UserId == userId && x.RevokedAt == null &&
            x.ExpiresAt > now && x.SecurityStamp == stamp, token);
    public async Task<PasswordResetGrant?> ResetGrantAsync(Guid userId, CancellationToken token)
    {
        // Credential verification checks whether setup is pending before acquiring
        // the user lock. That lookup must never stage a write of an old grant.
        if (db.Database.CurrentTransaction is null)
            return await db.Users.AsNoTracking()
                .Where(x => x.Id == userId && EF.Property<string>(x, "reset_token_hash") != null)
                .Select(x => new PasswordResetGrant
                {
                    UserId = x.Id,
                    TokenHash = EF.Property<string>(x, "reset_token_hash"),
                    ExpiresAt = EF.Property<DateTimeOffset?>(x, "reset_expires_at")!.Value,
                    ConsumedAt = EF.Property<DateTimeOffset?>(x, "reset_consumed_at")
                }).SingleOrDefaultAsync(token);
        var user = await db.Users.FindAsync([userId], token);
        if (user is null) return null;
        var entry = db.Entry(user);
        var hash = entry.Property<string>("reset_token_hash").CurrentValue;
        if (hash is null) return null;
        var grant = new PasswordResetGrant
        {
            UserId = userId,
            TokenHash = hash,
            ExpiresAt = entry.Property<DateTimeOffset?>("reset_expires_at").CurrentValue ?? throw new InvalidOperationException("Incomplete reset grant."),
            ConsumedAt = entry.Property<DateTimeOffset?>("reset_consumed_at").CurrentValue
        };
        grants[userId] = grant;
        return grant;
    }
    public void AddResetGrant(PasswordResetGrant grant) => grants.Add(grant.UserId, grant);
    public Task ConsumeResetGrantsAsync(Guid userId, DateTimeOffset now, CancellationToken token) =>
        db.Users.Where(x => x.Id == userId && EF.Property<string>(x, "reset_token_hash") != null && EF.Property<DateTimeOffset?>(x, "reset_consumed_at") == null)
            .ExecuteUpdateAsync(u => u.SetProperty(x => EF.Property<DateTimeOffset?>(x, "reset_consumed_at"), now), token);

    public async Task<int> SaveChangesAsync(CancellationToken token)
    {
        // Login failure and forbidden audits can be emitted without an explicit
        // session transaction. Keep their persistence atomic too.
        await using var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        foreach (var value in sessions.Values)
        {
            var row = db.Set<CompactRefreshRow>().Local.Single(x => x.Id == value.Id);
            row.SecurityStamp = value.SecurityStamp; row.DeviceLabel = value.Device;
            row.IssuedAt = value.CreatedAt; row.LastActivityAt = value.LastActivityAt; row.ExpiresAt = value.ExpiresAt;
            row.RevokedAt = value.RevokedAt; row.RevocationReason = value.RevocationReason;
        }
        foreach (var value in tokens.Values)
        {
            var row = db.Set<CompactRefreshRow>().Local.Single(x => x.Id == value.Id);
            row.TokenHash = value.TokenHash; row.IssuedAt = value.CreatedAt; row.ExpiresAt = value.ExpiresAt;
            row.ConsumedAt = value.ConsumedAt; row.ReplacedByTokenId = value.ReplacedByTokenId;
        }
        foreach (var value in grants.Values)
        {
            var entry = db.Entry(db.Users.Local.Single(x => x.Id == value.UserId));
            entry.Property("reset_token_hash").CurrentValue = value.TokenHash;
            entry.Property("reset_expires_at").CurrentValue = value.ExpiresAt;
            entry.Property("reset_consumed_at").CurrentValue = value.ConsumedAt;
        }
        var count = await db.SaveChangesAsync(token);
        foreach (var record in audit)
        {
            var data = JsonSerializer.Serialize(new { schemaVersion = 1, record.TargetUserId, record.SessionId, record.TargetType, record.TargetId, record.Succeeded });
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at)
                VALUES ({record.Id},'AUDIT',{record.UserId},{"auth:" + record.Id.ToString("N")},{record.Event},{record.TargetType ?? "User"},{record.TargetId ?? record.TargetUserId},CAST({data} AS jsonb),{record.OccurredAt})
                """, token);
        }
        if (owned is not null) await owned.CommitAsync(token);
        audit.Clear();
        // A later call in the same scope must reload committed revocation/reset state.
        sessions.Clear(); tokens.Clear(); grants.Clear();
        return count;
    }
}
