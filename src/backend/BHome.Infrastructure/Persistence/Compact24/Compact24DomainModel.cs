using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BHome.Infrastructure.Persistence.Compact24;

internal static class Compact24DomainModel
{
    internal static void Configure(ModelBuilder model)
    {
        // Reuse domain relationship configuration; SQL projections replace every source table.
        model.ConfigureCapture();
        model.ConfigureContracts();
        model.ApplyConfigurationsFromAssembly(typeof(Compact24DomainModel).Assembly);
        model.Ignore<AuthenticationSession>();
        model.Ignore<RefreshTokenRecord>();
        model.Ignore<PasswordResetGrant>();
        model.Ignore<IdentityUserClaim<Guid>>();
        model.Ignore<IdentityRoleClaim<Guid>>();
        model.Ignore<IdentityUserLogin<Guid>>();
        model.Ignore<IdentityUserToken<Guid>>();
        model.Entity<IdentityUserRole<Guid>>().HasKey(x => new { x.UserId, x.RoleId });

        foreach (var entity in model.Model.GetEntityTypes().ToArray())
        {
            if (entity.ClrType == typeof(ApplicationUser) || entity.ClrType == typeof(CompactRefreshRow)) continue;
            var spec = Compact24Records.For(entity.ClrType);
            var builder = model.Entity(entity.ClrType);
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(property.Name);
                property.ValueGenerated = ValueGenerated.Never;
            }
            // No views or compatibility tables are created. Queries execute against Compact24.
            builder.ToTable((string?)null);
            builder.ToSqlQuery(spec.Select(entity).Replace("{", "{{", StringComparison.Ordinal).Replace("}", "}}", StringComparison.Ordinal));
        }
    }
}
