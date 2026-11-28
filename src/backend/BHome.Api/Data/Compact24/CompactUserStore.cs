using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

// Identity still owns hashing, validation, token providers, lockout and security stamps.
// This store only persists the supported capabilities in users; no extra Identity tables.
internal sealed class CompactUserStore(Compact24DbContext db) :
    IQueryableUserStore<User>, IUserPasswordStore<User>, IUserEmailStore<User>,
    IUserPhoneNumberStore<User>, IUserSecurityStampStore<User>, IUserLockoutStore<User>,
    IUserTwoFactorStore<User>, IUserRoleStore<User>
{
    public IQueryable<User> Users => db.Users;
    public void Dispose() { }
    public Task<string> GetUserIdAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.Id.ToString()); }
    public Task<string?> GetUserNameAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.UserName); }
    public Task SetUserNameAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.UserName = v; return Task.CompletedTask; }
    public Task<string?> GetNormalizedUserNameAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.NormalizedUserName); }
    public Task SetNormalizedUserNameAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.NormalizedUserName = v; return Task.CompletedTask; }
    public Task<User?> FindByIdAsync(string id, CancellationToken t) => Guid.TryParse(id, out var key) ? db.Users.SingleOrDefaultAsync(u => u.Id == key, t) : Task.FromResult<User?>(null);
    public Task<User?> FindByNameAsync(string name, CancellationToken t) => db.Users.SingleOrDefaultAsync(u => u.NormalizedUserName == name, t);
    public Task<User?> FindByEmailAsync(string email, CancellationToken t) => db.Users.SingleOrDefaultAsync(u => u.NormalizedEmail == email, t);
    public Task SetPasswordHashAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.PasswordHash = v; return Task.CompletedTask; }
    public Task<string?> GetPasswordHashAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.PasswordHash); }
    public Task<bool> HasPasswordAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.PasswordHash is not null); }
    public Task SetEmailAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.Email = v; return Task.CompletedTask; }
    public Task<string?> GetEmailAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.Email); }
    public Task<bool> GetEmailConfirmedAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.EmailConfirmed); }
    public Task SetEmailConfirmedAsync(User u, bool v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.EmailConfirmed = v; return Task.CompletedTask; }
    public Task<string?> GetNormalizedEmailAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.NormalizedEmail); }
    public Task SetNormalizedEmailAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.NormalizedEmail = v; return Task.CompletedTask; }
    public Task SetPhoneNumberAsync(User u, string? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.PhoneNumber = v; return Task.CompletedTask; }
    public Task<string?> GetPhoneNumberAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.PhoneNumber); }
    public Task<bool> GetPhoneNumberConfirmedAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.PhoneNumberConfirmed); }
    public Task SetPhoneNumberConfirmedAsync(User u, bool v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.PhoneNumberConfirmed = v; return Task.CompletedTask; }
    public Task SetSecurityStampAsync(User u, string v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.SecurityStamp = v; return Task.CompletedTask; }
    public Task<string?> GetSecurityStampAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.SecurityStamp); }
    public Task<DateTimeOffset?> GetLockoutEndDateAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.LockoutEnd); }
    public Task SetLockoutEndDateAsync(User u, DateTimeOffset? v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.LockoutEnd = v; return Task.CompletedTask; }
    public Task<int> IncrementAccessFailedCountAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(++u.AccessFailedCount); }
    public Task ResetAccessFailedCountAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); u.AccessFailedCount = 0; return Task.CompletedTask; }
    public Task<int> GetAccessFailedCountAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.AccessFailedCount); }
    public Task<bool> GetLockoutEnabledAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.LockoutEnabled); }
    public Task SetLockoutEnabledAsync(User u, bool v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.LockoutEnabled = v; return Task.CompletedTask; }
    public Task SetTwoFactorEnabledAsync(User u, bool v, CancellationToken t) { t.ThrowIfCancellationRequested(); u.TwoFactorEnabled = v; return Task.CompletedTask; }
    public Task<bool> GetTwoFactorEnabledAsync(User u, CancellationToken t) { t.ThrowIfCancellationRequested(); return Task.FromResult(u.TwoFactorEnabled); }
    public Task AddToRoleAsync(User u, string role, CancellationToken t)
    {
        t.ThrowIfCancellationRequested(); var canonical = CanonicalRole(role);
        var entry = db.Entry(u).Property<string[]>("roles");
        entry.CurrentValue = (entry.CurrentValue ?? []).Append(canonical).Distinct().Order().ToArray();
        return Task.CompletedTask;
    }
    public Task RemoveFromRoleAsync(User u, string role, CancellationToken t)
    {
        t.ThrowIfCancellationRequested(); var canonical = CanonicalRole(role);
        var entry = db.Entry(u).Property<string[]>("roles");
        entry.CurrentValue = (entry.CurrentValue ?? []).Where(x => x != canonical).ToArray();
        return Task.CompletedTask;
    }
    public Task<IList<string>> GetRolesAsync(User u, CancellationToken t)
    { t.ThrowIfCancellationRequested(); return Task.FromResult<IList<string>>((db.Entry(u).Property<string[]>("roles").CurrentValue ?? []).ToArray()); }
    public async Task<bool> IsInRoleAsync(User u, string role, CancellationToken t) => (await GetRolesAsync(u, t)).Contains(CanonicalRole(role));
    public async Task<IList<User>> GetUsersInRoleAsync(string role, CancellationToken t)
    { var canonical = CanonicalRole(role); return await db.Users.Where(u => EF.Property<string[]>(u, "roles").Contains(canonical)).ToArrayAsync(t); }
    private static string CanonicalRole(string role) => Roles.All.SingleOrDefault(r => string.Equals(r, role, StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException("Unsupported business role.");

    public async Task<IdentityResult> CreateAsync(User user, CancellationToken token)
    {
        if (user.Id == Guid.Empty) user.Id = Guid.NewGuid();
        // The target disallows a role-less intermediate user. No implicit/default role is invented.
        var roles = db.Entry(user).Property<string[]>("roles").CurrentValue ?? [];
        if (roles.Length == 0) return Failure("CompactRoleRequired");
        db.Users.Add(user);
        try { await db.SaveChangesAsync(token); return IdentityResult.Success; }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        { db.Entry(user).State = EntityState.Detached; return Failure("DuplicateUserOrOwner"); }
    }

    public async Task<IdentityResult> UpdateAsync(User user, CancellationToken token)
    {
        var ownedTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        try
        {
            // Take the same user lock as session rotation before comparing ORIGINAL concurrency state.
            var stored = await db.Users.FromSqlInterpolated($"SELECT * FROM users WHERE id={user.Id} FOR UPDATE").AsNoTracking().SingleOrDefaultAsync(token);
            if (stored is null) return Failure("ConcurrencyFailure");
            var entry = db.Entry(user);
            if (entry.State == EntityState.Detached) db.Attach(user);
            var expected = entry.Property(x => x.ConcurrencyStamp).OriginalValue;
            if (stored.ConcurrencyStamp != expected) return Failure("ConcurrencyFailure");
            var roles = entry.Property<string[]>("roles").CurrentValue ?? [];
            if (roles.Length == 0) return Failure("CompactRoleRequired");
            user.ConcurrencyStamp = Guid.NewGuid().ToString();
            entry.State = EntityState.Modified;
            await db.SaveChangesAsync(token);
            // The reviewed schema revokes sessions and writes the independent audit atomically.
            if (ownedTransaction is not null) await ownedTransaction.CommitAsync(token);
            return IdentityResult.Success;
        }
        catch (DbUpdateConcurrencyException) { return Failure("ConcurrencyFailure"); }
        finally { if (ownedTransaction is not null) await ownedTransaction.DisposeAsync(); }
    }
    public Task<IdentityResult> DeleteAsync(User user, CancellationToken token)
    { token.ThrowIfCancellationRequested(); return Task.FromResult(Failure("AccountDeletionRequiresRetentionDecision")); }
    private static IdentityResult Failure(string code) => IdentityResult.Failed(new IdentityError { Code = code, Description = code });
}
