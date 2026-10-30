using BHome.Domain.Common;
using BHome.Infrastructure.IdentityAccess;
using BusinessRoles = BHome.Domain.IdentityAccess.Roles;
using BHome.Infrastructure.Jobs;
using BHome.Domain.Locations;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence;

public sealed class BHomeDbContext(DbContextOptions<BHomeDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    internal DbSet<BackgroundJobRecord> BackgroundJobs => Set<BackgroundJobRecord>();
    public DbSet<AuthenticationSession> AuthenticationSessions => Set<AuthenticationSession>();
    public DbSet<RefreshTokenRecord> RefreshTokens => Set<RefreshTokenRecord>();
    public DbSet<PasswordResetGrant> PasswordResetGrants => Set<PasswordResetGrant>();
    public DbSet<SecurityAuditRecord> SecurityAudit => Set<SecurityAuditRecord>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<StaffLocationAssignment> StaffLocationAssignments => Set<StaffLocationAssignment>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.ConfigureCapture();
        builder.ConfigureContracts();
        builder.Entity<ApplicationUser>().Property(x => x.IsActive).HasDefaultValue(true);
        builder.ApplyConfigurationsFromAssembly(typeof(BHomeDbContext).Assembly);
        builder.Entity<IdentityRole<Guid>>().HasData(
            new IdentityRole<Guid>(BusinessRoles.Owner) { Id = Guid.Parse("00000000-0000-0000-0000-000000000001"), NormalizedName = BusinessRoles.Owner.ToUpperInvariant() },
            new IdentityRole<Guid>(BusinessRoles.Staff) { Id = Guid.Parse("00000000-0000-0000-0000-000000000002"), NormalizedName = BusinessRoles.Staff.ToUpperInvariant() },
            new IdentityRole<Guid>(BusinessRoles.Tenant) { Id = Guid.Parse("00000000-0000-0000-0000-000000000003"), NormalizedName = BusinessRoles.Tenant.ToUpperInvariant() });
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampEntities();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampEntities();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void StampEntities()
    {
        if (ChangeTracker.Entries<BHome.Domain.PropertyManagement.PropertyChange>()
            .Any(x => x.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Property history is append-only.");
        if (ChangeTracker.Entries<SecurityAuditRecord>().Any(x => x.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Security audit is append-only.");
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in ChangeTracker.Entries<AuditableEntity>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified))
            entry.Entity.Stamp(now, entry.State == EntityState.Added);
    }
}
