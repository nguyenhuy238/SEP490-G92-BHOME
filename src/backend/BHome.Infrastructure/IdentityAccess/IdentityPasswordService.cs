using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentityPasswordService(IIdentityPersistence db, IdentitySecurityStore security,
    UserManager<ApplicationUser> users, IPasswordResetDelivery delivery, IOptions<SessionOptions> options,
    TimeProvider clock, IOptions<AuthenticationEmailOptions> emailOptions) : IPasswordService
{
    public async Task<bool> ChangeAsync(Guid userId, Guid sessionId, string currentPassword, string newPassword,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!ValidPasswordInput(currentPassword) || !ValidPasswordInput(newPassword) ||
            string.Equals(currentPassword, newPassword, StringComparison.Ordinal)) return false;
        await using var transaction = await db.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(userId, cancellationToken);
        if (user is null || !security.IsEligible(user)) return false;
        // Recheck the authenticated session after acquiring the same lock used by logout/refresh.
        var now = clock.GetUtcNow();
        if (!await db.CurrentSessionAsync(userId, sessionId, user.SecurityStamp, now, cancellationToken)) return false;
        var changed = await users.ChangePasswordAsync(user, currentPassword, newPassword);
        cancellationToken.ThrowIfCancellationRequested();
        security.Audit("PasswordChange", changed.Succeeded, userId, sessionId);
        if (changed.Succeeded)
        {
            await security.RevokeAllAsync(userId, "PasswordChanged", cancellationToken);
            await db.ConsumeResetGrantsAsync(userId, now, cancellationToken);
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
        var candidate = await users.FindByEmailAsync(userName.Trim()) ?? await users.FindByNameAsync(userName);
        if (candidate is null) return;
        string? token = null;
        string? destination = null;
        await using (var transaction = await db.BeginTransactionAsync(cancellationToken))
        {
            var user = await security.LockUserAsync(candidate.Id, cancellationToken);
            if (user is null || !user.IsActive || !user.EmailConfirmed || string.IsNullOrWhiteSpace(user.Email)) return;
            token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
            destination = user.Email;
            var grant = await db.ResetGrantAsync(user.Id, cancellationToken);
            var now = clock.GetUtcNow();
            if (grant is { ConsumedAt: null } && grant.ExpiresAt > now &&
                grant.ExpiresAt.AddMinutes(-options.Value.PasswordResetMinutes).AddSeconds(emailOptions.Value.ResendCooldownSeconds) > now) return;
            if (grant is null) { grant = new PasswordResetGrant { UserId = user.Id }; db.AddResetGrant(grant); }
            grant.TokenHash = IdentitySecurityStore.Hash(token);
            grant.ExpiresAt = clock.GetUtcNow().AddMinutes(options.Value.PasswordResetMinutes);
            grant.ConsumedAt = null;
            security.Audit("PasswordResetRequested", true, user.Id);
            if (delivery.IsDurable) await delivery.QueueAsync(new(user.Id, destination, token, grant.ExpiresAt), cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        if (!delivery.IsDurable)
        {
            try { await delivery.SendAsync(candidate.Id, destination, token, cancellationToken); }
            catch (Exception e) when (e is not OperationCanceledException) { /* Generic response also on synchronous adapter failure. */ }
        }
    }

    public async Task<bool> ResetAsync(string userName, string token, string newPassword, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > LoginService.MaxUserNameLength ||
            string.IsNullOrWhiteSpace(token) || token.Length > 4096 || !ValidPasswordInput(newPassword)) return false;
        var candidate = await users.FindByEmailAsync(userName.Trim()) ?? await users.FindByNameAsync(userName);
        if (candidate is null) return false;
        string decoded;
        try { decoded = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)); }
        catch (FormatException) { return false; }
        await using var transaction = await db.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(candidate.Id, cancellationToken);
        var now = clock.GetUtcNow();
        var hash = IdentitySecurityStore.Hash(token);
        var grant = await db.ResetGrantAsync(candidate.Id, cancellationToken);
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
