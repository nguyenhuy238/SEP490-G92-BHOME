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
    : BHomePersistenceContext(options)
{
    public override BHomePersistenceContext CreateIndependentContext() => new BHomeDbContext(options);
    public override async Task<bool> IsSchemaReadyAsync(CancellationToken token = default) =>
        await Database.CanConnectAsync(token) && !(await Database.GetPendingMigrationsAsync(token)).Any();

    internal override async Task<IReadOnlyList<BHome.Application.Billing.BillingQueueView>> BillingQueueAsync(Guid location, DateOnly period, CancellationToken token)
    {
        var key = period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        return await Database.SqlQuery<BHome.Application.Billing.BillingQueueView>($"""
            SELECT j."Id",j."Name",j."State",j."Attempts",j."AvailableAt",j."LockedUntil",j."LastErrorCode"
            FROM "BackgroundJobs" j JOIN "BillingAutomationPlans" p ON j."PayloadJson"->>'PlanId'=p."Id"::text
            WHERE p."LocationId"={location} AND j."PayloadJson"->>'BillingPeriod'={key}
              AND j."Name" IN ('billing-meter','billing-draft','billing-final')
            ORDER BY j."AvailableAt" DESC LIMIT 30
            """).ToArrayAsync(token);
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.ConfigureCapture();
        // Freeze the archived source schema for offline import/regression. Runtime Compact24
        // supports pre-account/departed Residents with a nullable current Room independently.
        builder.Entity<BHome.Domain.TenantContracts.Resident>().Property(r => r.RoomId).IsRequired();
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
        if (ChangeTracker.Entries().Any(x =>
            (x.Entity is BHome.Domain.StaffOperations.OperationalTaskHistory or BHome.Domain.StaffOperations.OperationalTaskCommand) &&
            x.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Task history and commands are append-only.");
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
