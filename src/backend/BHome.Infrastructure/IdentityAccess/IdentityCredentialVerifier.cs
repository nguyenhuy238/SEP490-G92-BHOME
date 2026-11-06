using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityCredentialVerifier(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn)
    : ICredentialVerifier
{
    public async Task<VerifiedIdentity?> VerifyAsync(string identifier, string password, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationUser[] matches;
        if (LoginIdentifier.IsEmail(identifier))
        {
            var normalizedEmail = users.NormalizeEmail(identifier);
            // Legacy/imported data can bypass Identity's unique-email validator. Never pick an arbitrary account.
            matches = await users.Users.Where(user => user.NormalizedEmail == normalizedEmail)
                .Take(2).ToArrayAsync(cancellationToken);
        }
        else
        {
            var phone = LoginIdentifier.NormalizePhone(identifier);
            if (phone is null) return null;
            matches = await users.Users.Where(user => user.PhoneNumber != null &&
                    user.PhoneNumber.Replace(" ", "").Replace("-", "").Replace(".", "")
                        .Replace("(", "").Replace(")", "") == phone)
                .Take(2).ToArrayAsync(cancellationToken);
        }
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
