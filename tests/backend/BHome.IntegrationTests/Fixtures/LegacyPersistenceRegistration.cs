using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.Locations;
using BHome.Application.Notifications;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Locations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Fixtures;

// Explicit source-schema regression composition, confined to the test assembly.
// Production has no setting, detection or fallback that can select this path.
internal static class LegacyPersistenceRegistration
{
    internal static IServiceCollection UseLegacyPersistenceForTesting(this IServiceCollection services)
    {
        services.RemoveAll<Compact24DbContext>(); services.RemoveAll<DbContextOptions<Compact24DbContext>>();
        services.RemoveAll<CompactJobPersistence>(); services.RemoveAll<CompactLocationAssignments>();
        services.AddDbContext<BHomeDbContext>((p, o) => o.UseNpgsql(p.GetRequiredService<IOptions<DatabaseOptions>>().Value.Database));
        services.Replace(ServiceDescriptor.Scoped<BHomePersistenceContext>(p => p.GetRequiredService<BHomeDbContext>()));
        services.RemoveAll<IUserStore<ApplicationUser>>(); services.RemoveAll<IRoleStore<IdentityRole<Guid>>>();
        services.AddIdentityCore<ApplicationUser>().AddRoles<IdentityRole<Guid>>().AddEntityFrameworkStores<BHomeDbContext>();
        services.RemoveAll<IUserClaimsPrincipalFactory<ApplicationUser>>();
        services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, UserClaimsPrincipalFactory<ApplicationUser, IdentityRole<Guid>>>();
        services.Replace(ServiceDescriptor.Scoped<IIdentityPersistence, LegacyIdentityPersistence>());
        services.Replace(ServiceDescriptor.Scoped<IBackgroundJobQueue, PostgresJobQueue>());
        services.Replace(ServiceDescriptor.Scoped<IJobPersistence, LegacyJobPersistence>());
        services.AddScoped<PostgresLocationAssignments>();
        services.Replace(ServiceDescriptor.Scoped<ILocationAssignments>(p => p.GetRequiredService<PostgresLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<IStaffLocationAccess>(p => p.GetRequiredService<PostgresLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<INotificationRepository, BHome.Infrastructure.Modules.Notifications.NotificationRepository>());
        return services;
    }
}
