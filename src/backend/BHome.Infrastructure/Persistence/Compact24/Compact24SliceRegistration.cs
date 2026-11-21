using BHome.Application.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using System.Security.Claims;
using BHome.Application.Jobs;
using BHome.Infrastructure.Jobs;
using BHome.Application.Locations;
using BHome.Application.Notifications;

namespace BHome.Infrastructure.Persistence.Compact24;

internal static class Compact24SliceRegistration
{
    // Explicit adapter composition for older focused tests. The default API uses the same
    // implementations through AddInfrastructure; production has no legacy-selection switch.
    internal static IServiceCollection UseCompact24PersistenceForTesting(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<Compact24DbContext>(o => o.UseNpgsql(connectionString));
        services.Replace(ServiceDescriptor.Scoped<BHomePersistenceContext>(p => p.GetRequiredService<Compact24DbContext>()));
        services.Replace(ServiceDescriptor.Scoped<IUserStore<ApplicationUser>, CompactUserStore>());
        services.Replace(ServiceDescriptor.Scoped<IRoleStore<IdentityRole<Guid>>, CompactRoleStore>());
        services.Replace(ServiceDescriptor.Scoped<IUserClaimsPrincipalFactory<ApplicationUser>, CompactClaimsPrincipalFactory>());
        services.Replace(ServiceDescriptor.Scoped<IIdentityPersistence, CompactIdentityPersistence>());
        services.AddScoped<CompactJobPersistence>();
        services.Replace(ServiceDescriptor.Scoped<IBackgroundJobQueue>(p => p.GetRequiredService<CompactJobPersistence>()));
        services.Replace(ServiceDescriptor.Scoped<IJobPersistence>(p => p.GetRequiredService<CompactJobPersistence>()));
        services.AddScoped<CompactLocationAssignments>();
        services.Replace(ServiceDescriptor.Scoped<ILocationAssignments>(p => p.GetRequiredService<CompactLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<IStaffLocationAccess>(p => p.GetRequiredService<CompactLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<INotificationRepository, CompactNotificationRepository>());
        return services;
    }
}

internal sealed class CompactClaimsPrincipalFactory(UserManager<ApplicationUser> users, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<ApplicationUser>(users, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(ApplicationUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        foreach (var role in await UserManager.GetRolesAsync(user))
            identity.AddClaim(new Claim(Options.ClaimsIdentity.RoleClaimType, role));
        return identity;
    }
}
