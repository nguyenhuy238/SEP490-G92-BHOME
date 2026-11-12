using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityCredentialVerifier(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, IIdentityPersistence persistence)
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
            var phones = users.Users.Where(user => user.PhoneNumber != null).Select(user => new
            {
                User = user,
                Phone = user.PhoneNumber!.Replace(" ", "").Replace("-", "").Replace(".", "").Replace("(", "").Replace(")", "")
            });
            matches = await phones.Where(row =>
                (row.Phone.StartsWith("0") && (row.Phone.Length == 10 || row.Phone.Length == 11)
                    ? "+84" + row.Phone.Substring(1) : row.Phone) == phone)
                .Select(row => row.User).Take(2).ToArrayAsync(cancellationToken);
        }
        if (matches.Length != 1 || !matches[0].IsActive) return null;
        var user = matches[0];
        // Only accounts with an explicit invitation grant wait for setup. This does not introduce
        // a global confirmed-email requirement for existing accounts.
        if (!user.EmailConfirmed && await persistence.ResetGrantAsync(user.Id, cancellationToken) is { ConsumedAt: null }) return null;

        // Password verification alone must never bypass a configured second factor.
        if (await users.GetTwoFactorEnabledAsync(user)) return null;
        var result = await signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);
        if (!result.Succeeded) return null;

        var roles = await users.GetRolesAsync(user);
        cancellationToken.ThrowIfCancellationRequested();
        return new VerifiedIdentity(user.Id, roles.ToArray(), user.SecurityStamp ?? "");
    }
}
