using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityCredentialVerifier(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn)
    : ICredentialVerifier
{
    public async Task<VerifiedIdentity?> VerifyAsync(string email, string password, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalizedEmail = users.NormalizeEmail(email.Trim());
        // Legacy/imported data can bypass Identity's unique-email validator. Never pick an arbitrary account.
        var matches = await users.Users.Where(user => user.NormalizedEmail == normalizedEmail)
            .Take(2).ToArrayAsync(cancellationToken);
        if (matches.Length != 1 || !matches[0].IsActive) return null;
        var user = matches[0];

        // Password verification alone must never bypass a configured second factor.
        if (await users.GetTwoFactorEnabledAsync(user)) return null;
        var result = await signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);
        if (!result.Succeeded) return null;

        var roles = await users.GetRolesAsync(user);
        cancellationToken.ThrowIfCancellationRequested();
        return new VerifiedIdentity(user.Id, roles.ToArray(), user.SecurityStamp ?? "");
    }
}
