using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityCredentialVerifier(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn)
    : ICredentialVerifier
{
    public async Task<VerifiedIdentity?> VerifyAsync(string userName, string password, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var user = await users.FindByNameAsync(userName);
        if (user is null) return null;

        // Password verification alone must never bypass a configured second factor.
        if (await users.GetTwoFactorEnabledAsync(user)) return null;
        var result = await signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);
        if (!result.Succeeded) return null;

        var roles = await users.GetRolesAsync(user);
        cancellationToken.ThrowIfCancellationRequested();
        return new VerifiedIdentity(user.Id, roles.ToArray());
    }
}
