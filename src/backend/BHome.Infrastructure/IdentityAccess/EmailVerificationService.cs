using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

// Verification has its own outbox grant; it never replaces a password-reset or invitation grant.
internal sealed class EmailVerificationService(IIdentityPersistence identity, IdentitySecurityStore security,
    UserManager<ApplicationUser> users, AuthenticationEmailDelivery delivery, CompactNotificationWriter sql,
    IOptions<AuthenticationEmailOptions> options, IOptions<SessionOptions> sessions, IHostEnvironment environment) : IEmailVerification
{
    public async Task RequestAsync(string userName, CancellationToken t)
    {
        if (!delivery.IsAvailable || !options.Value.VerificationConfigured(environment.IsDevelopment()))
            throw new IntegrationUnavailableException("Email verification delivery is not configured.");
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > LoginService.MaxUserNameLength) return;
        var candidate = await users.FindByEmailAsync(userName.Trim()) ?? await users.FindByNameAsync(userName.Trim());
        if (candidate is null) return;
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t);
        if (user is null || !EmailOptions.ValidAddress(user.Email) || !await EligibleAsync(sql, user.Id, t)) return;
        if (await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM notifications WHERE record_kind='OUTBOX'
              AND event_data->>'authenticationKind'='EmailConfirmation' AND event_data->>'recipient'=@user::text
              AND event_at>@since)
            """, t, ("user", user.Id), ("since", sql.Now.AddSeconds(-options.Value.ResendCooldownSeconds)))) return;
        var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GenerateEmailConfirmationTokenAsync(user)));
        await delivery.QueueAsync(new(user.Id, user.Email!, token, sql.Now.AddMinutes(sessions.Value.PasswordResetMinutes), "EmailConfirmation"), t);
        security.Audit("EmailConfirmationRequested", true, user.Id);
        await identity.SaveChangesAsync(t);
        await tx.CommitAsync(t);
    }

    public async Task<bool> ConfirmAsync(string userName, string token, CancellationToken t)
    {
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > LoginService.MaxUserNameLength ||
            string.IsNullOrWhiteSpace(token) || token.Length > 4096) return false;
        string decoded;
        try { decoded = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)); }
        catch (FormatException) { return false; }
        var candidate = await users.FindByEmailAsync(userName.Trim()) ?? await users.FindByNameAsync(userName.Trim());
        if (candidate is null) return false;
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t);
        if (user is null || !await CurrentAsync(sql, user.Id, user.Email ?? "", token, t)) return false;
        var confirmed = await users.ConfirmEmailAsync(user, decoded);
        if (!confirmed.Succeeded) return false;
        security.Audit("EmailConfirmed", true, user.Id);
        await identity.SaveChangesAsync(t);
        await tx.CommitAsync(t);
        return true;
    }

    internal static Task<bool> EligibleAsync(CompactNotificationWriter sql, Guid user, CancellationToken t) => sql.Scalar<bool>("""
        SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=@user AND u.is_active AND NOT u.email_confirmed
          AND NOT (u.reset_token_hash IS NOT NULL AND u.reset_consumed_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM operational_tasks j JOIN residents r
            ON r.id::text=j.task_data->'payload'->>'ResidentId'
            WHERE r.user_id=u.id AND u.reset_consumed_at IS NULL
              AND j.task_type='SYSTEM_JOB' AND j.task_data->>'name'=@invitation))
        """, t, ("user", user), ("invitation", AccountInvitationJob.JobName));

    internal static async Task<bool> CurrentAsync(CompactNotificationWriter sql, Guid user, string email, string token, CancellationToken t)
    {
        if (!await EligibleAsync(sql, user, t)) return false;
        return await sql.Scalar<bool>("""
            SELECT COALESCE((SELECT event_data->>'tokenHash'=@hash AND event_data->>'destinationHash'=@email
              AND (event_data->>'expiresAt')::timestamptz>@now
              FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'authenticationKind'='EmailConfirmation'
                AND event_data->>'recipient'=@user::text ORDER BY event_at DESC,id DESC LIMIT 1),false)
            """, t, ("user", user), ("hash", IdentitySecurityStore.Hash(token)),
            ("email", IdentitySecurityStore.Hash(email.Trim().ToUpperInvariant())), ("now", sql.Now));
    }
}
