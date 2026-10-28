using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityPasswordService(BHomeDbContext db, IdentitySecurityStore security,
    UserManager<ApplicationUser> users, IPasswordResetDelivery delivery, IOptions<SessionOptions> options,
    TimeProvider clock) : IPasswordService
{
    public async Task<bool> ChangeAsync(Guid userId, Guid sessionId, string currentPassword, string newPassword,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!ValidPasswordInput(currentPassword) || !ValidPasswordInput(newPassword)) return false;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(userId, cancellationToken);
        if (user is null || !security.IsEligible(user)) return false;
        // Recheck the authenticated session after acquiring the same lock used by logout/refresh.
        var now = clock.GetUtcNow();
        if (!await db.AuthenticationSessions.AnyAsync(x => x.Id == sessionId && x.UserId == userId &&
            x.RevokedAt == null && x.ExpiresAt > now && x.SecurityStamp == user.SecurityStamp, cancellationToken)) return false;
        var changed = await users.ChangePasswordAsync(user, currentPassword, newPassword);
        cancellationToken.ThrowIfCancellationRequested();
        security.Audit("PasswordChange", changed.Succeeded, userId, sessionId);
        if (changed.Succeeded)
        {
            await security.RevokeAllAsync(userId, "PasswordChanged", cancellationToken);
            await db.PasswordResetGrants.Where(x => x.UserId == userId && x.ConsumedAt == null)
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.ConsumedAt, now), cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return changed.Succeeded;
    }

    public async Task RequestResetAsync(string userName, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // Check availability before account lookup: all names have the same unavailable response.
        if (!delivery.IsAvailable) throw new IntegrationUnavailableException("Password reset delivery is not configured.");
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > LoginService.MaxUserNameLength) return;
        var candidate = await users.FindByNameAsync(userName);
        if (candidate is null) return;
        string? token = null;
        string? destination = null;
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            var user = await security.LockUserAsync(candidate.Id, cancellationToken);
            if (user is null || !user.IsActive || !user.EmailConfirmed || string.IsNullOrWhiteSpace(user.Email)) return;
            token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
            destination = user.Email;
            var grant = await db.PasswordResetGrants.SingleOrDefaultAsync(x => x.UserId == user.Id, cancellationToken);
            if (grant is null) { grant = new PasswordResetGrant { UserId = user.Id }; db.PasswordResetGrants.Add(grant); }
            grant.TokenHash = IdentitySecurityStore.Hash(token);
            grant.ExpiresAt = clock.GetUtcNow().AddMinutes(options.Value.PasswordResetMinutes);
            grant.ConsumedAt = null;
            security.Audit("PasswordResetRequested", true, user.Id);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        await delivery.SendAsync(candidate.Id, destination, token, cancellationToken);
    }

    public async Task<bool> ResetAsync(string userName, string token, string newPassword, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > LoginService.MaxUserNameLength ||
            string.IsNullOrWhiteSpace(token) || token.Length > 4096 || !ValidPasswordInput(newPassword)) return false;
        var candidate = await users.FindByNameAsync(userName);
        if (candidate is null) return false;
        string decoded;
        try { decoded = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)); }
        catch (FormatException) { return false; }
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(candidate.Id, cancellationToken);
        var now = clock.GetUtcNow();
        var hash = IdentitySecurityStore.Hash(token);
        var grant = await db.PasswordResetGrants.SingleOrDefaultAsync(x => x.UserId == candidate.Id, cancellationToken);
        if (user is null || !user.IsActive || grant is null || grant.ConsumedAt is not null || grant.ExpiresAt <= now || grant.TokenHash != hash)
            return false;
        var changed = await users.ResetPasswordAsync(user, decoded, newPassword);
        cancellationToken.ThrowIfCancellationRequested();
        security.Audit("PasswordReset", changed.Succeeded, user.Id);
        if (changed.Succeeded)
        {
            grant.ConsumedAt = now;
            await security.RevokeAllAsync(user.Id, "PasswordReset", cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return changed.Succeeded;
    }

    private static bool ValidPasswordInput(string password) => !string.IsNullOrWhiteSpace(password) && password.Length <= LoginService.MaxPasswordLength;
}

internal sealed class UnconfiguredPasswordResetDelivery : IPasswordResetDelivery
{
    public bool IsAvailable => false;
    public Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken) =>
        throw new IntegrationUnavailableException("Password reset delivery is not configured.");
}
