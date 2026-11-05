using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

// Source fixtures used to validate the approved single-Owner Compact24 import shape.
internal sealed class SingleOwnerMigrationFixture;

internal static class WorkflowTestUsers
{
    internal static async Task<ApplicationUser> CreateAsync(IServiceProvider services, ApplicationUser user, string role, string password)
    {
        var db = services.GetRequiredService<BHomePersistenceContext>();
        if (role == "Owner" && services.GetService<SingleOwnerMigrationFixture>() is not null)
        {
            var owners = await services.GetRequiredService<UserManager<ApplicationUser>>().GetUsersInRoleAsync(role);
            if (owners.Count == 1) return owners[0];
        }
        if (db is Compact24DbContext compact)
        {
            if (role == "Owner" && await compact.Users.Where(u => EF.Property<string[]>(u, "roles").Contains("Owner")).SingleOrDefaultAsync() is { } existing)
                return existing;
            compact.PrepareUserRole(user, role);
        }
        var manager = services.GetRequiredService<UserManager<ApplicationUser>>();
        var created = await manager.CreateAsync(user, password);
        Assert.True(created.Succeeded, string.Join(',', created.Errors.Select(e => e.Code)));
        if (!await manager.IsInRoleAsync(user, role)) Assert.True((await manager.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }
}
