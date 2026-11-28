using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using System.Security.Claims;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactClaimsPrincipalFactory(UserManager<User> users, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<User>(users, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(User user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        foreach (var role in await UserManager.GetRolesAsync(user))
            identity.AddClaim(new Claim(Options.ClaimsIdentity.RoleClaimType, role));
        return identity;
    }
}
