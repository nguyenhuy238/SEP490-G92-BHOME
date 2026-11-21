using BHome.Domain.Locations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Jobs;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence;

// Persistence contract used by the existing repositories. The offline legacy context and
// Compact24 share domain queries, never a database connection or runtime fallback.
public abstract class BHomePersistenceContext(DbContextOptions options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    internal DbSet<BackgroundJobRecord> BackgroundJobs => Set<BackgroundJobRecord>();
    public DbSet<AuthenticationSession> AuthenticationSessions => Set<AuthenticationSession>();
    public DbSet<RefreshTokenRecord> RefreshTokens => Set<RefreshTokenRecord>();
    public DbSet<PasswordResetGrant> PasswordResetGrants => Set<PasswordResetGrant>();
    public DbSet<SecurityAuditRecord> SecurityAudit => Set<SecurityAuditRecord>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<StaffLocationAssignment> StaffLocationAssignments => Set<StaffLocationAssignment>();

    public abstract BHomePersistenceContext CreateIndependentContext();
    public abstract Task<bool> IsSchemaReadyAsync(CancellationToken token = default);
    public virtual void PrepareUserRole(ApplicationUser user, string role) { }
    internal abstract Task<IReadOnlyList<BHome.Application.Billing.BillingQueueView>> BillingQueueAsync(Guid location, DateOnly period, CancellationToken token);

    public virtual IQueryable<T> Locked<T>(Guid id, bool skipLocked = false, bool shared = false) where T : class
    {
        var entity = Model.FindEntityType(typeof(T)) ?? throw new InvalidOperationException("Unknown persistence entity.");
        var table = entity.GetTableName()!;
        var suffix = shared ? " FOR SHARE" : " FOR UPDATE" + (skipLocked ? " SKIP LOCKED" : "");
        return Set<T>().FromSqlRaw($"SELECT * FROM \"{table}\" WHERE \"Id\"={{0}}" + suffix, id);
    }
}
