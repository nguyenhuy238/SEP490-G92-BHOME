using System.Security.Cryptography;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class AccountInvitations(Compact24DbContext db, IIdentityPersistence identity, IdentitySecurityStore security,
    UserManager<ApplicationUser> users, IPasswordResetDelivery delivery, ICurrentUser actor, CompactNotificationWriter sql,
    IOptions<SessionOptions> options, IOptions<AuthenticationEmailOptions> emailOptions) : IAccountInvitations
{
    // Existing grant state represents pending setup before an invitation is requested.
    // An expired random hash is unusable and does not start the invitation cooldown.
    internal static void MarkPendingSetup(Compact24DbContext context, ApplicationUser user, DateTimeOffset now)
    {
        context.Entry(user).Property("reset_token_hash").CurrentValue = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        context.Entry(user).Property("reset_expires_at").CurrentValue = now.AddSeconds(-1);
        context.Entry(user).Property("reset_consumed_at").CurrentValue = null;
    }

    // Exactly 12 characters with all four Identity-required classes. The selection and
    // shuffle use a cryptographic RNG; no generated password is stored or returned to Owner.
    internal static string NewStaffPassword()
    {
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const string lower = "abcdefghijkmnopqrstuvwxyz";
        const string digits = "23456789";
        const string symbols = "!@#$%&*?";
        const string alphabet = upper + lower + digits + symbols;
        var chars = new char[12];
        chars[0] = upper[RandomNumberGenerator.GetInt32(upper.Length)];
        chars[1] = lower[RandomNumberGenerator.GetInt32(lower.Length)];
        chars[2] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        chars[3] = symbols[RandomNumberGenerator.GetInt32(symbols.Length)];
        for (var i = 4; i < chars.Length; i++) chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        for (var i = chars.Length - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }

    public async Task<TenantInvitationResult> IssueStaffPasswordAsync(Guid userId, CancellationToken t)
    {
        if (actor.UserId is null || !actor.IsInRole(Roles.Owner)) throw new NotificationException(403, "staff_password_owner_required");
        if (!delivery.IsDurable || !delivery.IsAvailableFor("StaffCredentials"))
            throw new BHome.Application.Common.IntegrationUnavailableException("Staff credential email delivery is not configured.");
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(userId, t);
        if (user is null || !user.IsActive || !(await security.RolesAsync(userId, t)).Contains(Roles.Staff))
            throw new NotificationException(404, "staff_not_found");
        if (string.IsNullOrWhiteSpace(user.Email))
            throw new NotificationException(409, "staff_email_required");
        delivery.ValidateInvitationRecipient(user.Email);
        // Row locking serializes concurrent requests for the same Staff; a rapid retry
        // preserves the queued credential rather than silently replacing it again.
        var recentlyIssued = await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM notifications WHERE record_kind='AUDIT'
              AND related_entity_id=@user AND notification_type='StaffPasswordIssued' AND event_at>@since)
            """, t, ("user", user.Id), ("since", sql.Now.AddSeconds(-emailOptions.Value.ResendCooldownSeconds)));
        if (recentlyIssued) return new(user.Id, "ExistingRequestPreserved");

        // Legacy Staff created before direct provisioning can receive credentials
        // without an invitation. Keep the state change in the same transaction
        // as the password hash, revoked sessions and protected email outbox.
        user.EmailConfirmed = true;
        var password = NewStaffPassword();
        var result = await users.ResetPasswordAsync(user, await users.GeneratePasswordResetTokenAsync(user), password);
        if (!result.Succeeded) throw new NotificationException(409, "staff_password_update_failed");
        await security.RevokeAllAsync(user.Id, "StaffPasswordIssued", t);
        await identity.ConsumeResetGrantsAsync(user.Id, sql.Now, t);
        security.Audit("StaffPasswordIssued", true, user.Id);
        // Atomic hashed-password update + protected outbox enqueue. SMTP failure leaves a
        // visible, retryable delivery rather than an untracked changed credential.
        await delivery.QueueAsync(new(user.Id, user.Email, password, sql.Now.AddDays(7), "StaffCredentials"), t);
        await identity.SaveChangesAsync(t);
        await tx.CommitAsync(t);
        return new(user.Id, "Queued");
    }

    public async Task<TenantInvitationResult> InviteStaffAsync(Guid userId, CancellationToken t)
    {
        if (actor.UserId is null || !actor.IsInRole(Roles.Owner)) throw new NotificationException(403, "invitation_owner_required");
        if (!delivery.IsAvailableFor("StaffInvitation")) throw new BHome.Application.Common.IntegrationUnavailableException("Account invitation email is not configured.");
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(userId, t);
        if (user is null || !user.IsActive || !(await security.RolesAsync(userId, t)).Contains(Roles.Staff)) throw new NotificationException(404, "staff_not_found");
        if (string.IsNullOrWhiteSpace(user.Email)) throw new NotificationException(409, "account_not_eligible_for_invitation");
        delivery.ValidateInvitationRecipient(user.Email);
        var grant = await identity.ResetGrantAsync(user.Id, t);
        if (CoolingDown(grant)) return new(user.Id, "ExistingInvitationPreserved");
        // A Staff who has completed setup receives a reset link, while a new Staff
        // receives an invitation link. Neither flow discloses a password to the Owner.
        var confirmed = user.EmailConfirmed;
        var token = confirmed
            ? WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)))
            : await InvitationToken(user, t);
        if (grant is null) { grant = new PasswordResetGrant { UserId = user.Id }; identity.AddResetGrant(grant); }
        grant.TokenHash = IdentitySecurityStore.Hash(token); grant.ExpiresAt = sql.Now.AddMinutes(options.Value.PasswordResetMinutes); grant.ConsumedAt = null;
        security.Audit(confirmed ? "PasswordResetRequested" : "AccountInvitationCreated", true, user.Id);
        if (delivery.IsDurable) await delivery.QueueAsync(new(user.Id, user.Email, token, grant.ExpiresAt, confirmed ? "PasswordReset" : "StaffInvitation"), t);
        await identity.SaveChangesAsync(t); await tx.CommitAsync(t);
        if (delivery.IsDurable) return new(user.Id, "Queued");
        try { await delivery.SendAsync(user.Id, user.Email, token, t); return new(user.Id, "AcceptedByProvider"); }
        catch (Exception e) when (e is not OperationCanceledException) { return new(user.Id, "PendingRetry"); }
    }
    public async Task<TenantInvitationResult> InviteAsync(Guid residentId, TenantInvitationRequest request, CancellationToken t)
    {
        if (actor.UserId is not { } owner || !actor.IsInRole(Roles.Owner)) throw new NotificationException(403, "invitation_owner_required");
        return await InviteApprovedAsync(owner, residentId, request, t);
    }
    internal async Task<TenantInvitationResult> InviteApprovedAsync(Guid owner, Guid residentId, TenantInvitationRequest request, CancellationToken t, Guid? dispatchJob = null)
    {
        if (!delivery.IsAvailableFor("TenantInvitation")) throw new BHome.Application.Common.IntegrationUnavailableException("Account invitation email is not configured.");
        // Co-occupant account invitations are limited to a confirmed, active tenancy; never reserve or activate a room here.
        await using var tx = await identity.BeginTransactionAsync(t);
        if (dispatchJob is { } job)
        {
            var claimed = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['invitationDispatchState'],'"Dispatching"'::jsonb)
                WHERE id={job} AND task_type='SYSTEM_JOB' AND task_data->>'name'={AccountInvitationJob.JobName}
                  AND NOT task_data ? 'invitationDispatchState'
                """, t);
            if (claimed != 1) throw new InvalidOperationException("Invitation delivery is already dispatched or requires manual review.");
        }
        var userId = await sql.Scalar<Guid?>("""
            SELECT r.user_id FROM residents r WHERE r.id=@id AND EXISTS(SELECT 1 FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id
              WHERE cr.resident_id=r.id AND c.status=3 AND c.contract_type<>'HOLDING' AND c.owner_signer_id=@owner) FOR UPDATE
            """, t, ("id", residentId), ("owner", owner));
        var eligible = await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM residents r JOIN contract_residents cr ON cr.resident_id=r.id JOIN contracts c ON c.id=cr.contract_id
              WHERE r.id=@id AND c.status=3 AND c.contract_type<>'HOLDING' AND c.owner_signer_id=@owner)
            """, t, ("id", residentId), ("owner", owner));
        if (!eligible) throw new NotificationException(404, "eligible_resident_not_found");
        var contact = await sql.Scalar<string?>("SELECT contact_email FROM residents WHERE id=@id", t, ("id", residentId));
        if (contact is not null && !string.Equals(contact.Trim(), request.Email.Trim(), StringComparison.OrdinalIgnoreCase))
            throw new NotificationException(409, "resident_invitation_email_mismatch");
        ApplicationUser user;
        if (userId is { } linked)
        {
            user = await security.LockUserAsync(linked, t) ?? throw new NotificationException(404, "account_not_found");
            if (!user.IsActive || !(await security.RolesAsync(user.Id, t)).Contains(Roles.Tenant))
                throw new NotificationException(409, "linked_account_not_eligible");
            if (!string.Equals(user.Email, request.Email, StringComparison.OrdinalIgnoreCase)) throw new NotificationException(409, "linked_account_email_mismatch");
            if (user.EmailConfirmed) throw new NotificationException(409, "account_already_activated");
        }
        else
        {
            if (await users.FindByEmailAsync(request.Email) is not null) throw new NotificationException(409, "email_requires_explicit_account_link");
            var id = Guid.NewGuid(); user = new ApplicationUser
            {
                Id = id,
                UserName = request.Email,
                Email = request.Email,
                EmailConfirmed = false,
                // Pending invitation accounts must be addressable by the protected
                // delivery/validation pipeline. EmailConfirmed remains false, so they
                // cannot sign in until the one-time invitation is accepted.
                IsActive = true,
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N"),
                LockoutEnabled = true
            };
            db.Users.Add(user); db.Entry(user).Property("roles").CurrentValue = new[] { Roles.Tenant };
            // Unknowable random initial credential; no default password is issued to the user.
            user.PasswordHash = users.PasswordHasher.HashPassword(user, Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)) + "!aA1");
            user.NormalizedUserName = users.NormalizeName(user.UserName); user.NormalizedEmail = users.NormalizeEmail(user.Email);
            await db.SaveChangesAsync(t);
            var resident = await db.Set<BHome.Domain.Entities.Resident>().AsNoTracking().SingleAsync(r => r.Id == residentId, t);
            await NativeResidentPersistence.LinkAsync(db, NativeResidentPersistence.Read(resident), id, t);
        }
        delivery.ValidateInvitationRecipient(request.Email, automaticTenantSetup: dispatchJob is not null);
        var grant = await identity.ResetGrantAsync(user.Id, t);
        if (dispatchJob is { } queued && grant is { ConsumedAt: null } && grant.ExpiresAt > sql.Now)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['invitationDispatchState'],'"SupersededByExistingInvitation"'::jsonb) WHERE id={queued}
                """, t);
            await tx.CommitAsync(t); return new(user.Id, "ExistingInvitationPreserved");
        }
        if (CoolingDown(grant)) { await tx.CommitAsync(t); return new(user.Id, "ExistingInvitationPreserved"); }
        var token = await InvitationToken(user, t);
        if (grant is null) { grant = new PasswordResetGrant { UserId = user.Id }; identity.AddResetGrant(grant); }
        grant.TokenHash = IdentitySecurityStore.Hash(token); grant.ExpiresAt = sql.Now.AddMinutes(options.Value.PasswordResetMinutes); grant.ConsumedAt = null;
        security.Audit("AccountInvitationCreated", true, user.Id);
        if (delivery.IsDurable)
        {
            var kind = dispatchJob is null ? "TenantInvitation" : "PostActivationTenantInvitation";
            await delivery.QueueAsync(new(user.Id, request.Email, token, grant.ExpiresAt, kind), t);
            if (dispatchJob is { } scheduled) await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['invitationDispatchState'],'"Queued"'::jsonb) WHERE id={scheduled}
                """, t);
        }
        await identity.SaveChangesAsync(t); await tx.CommitAsync(t);
        if (delivery.IsDurable) return new(user.Id, "Queued");
        // Email failure cannot undo the account or tenancy; Owner can retry and replace the one-time grant.
        try
        {
            await delivery.SendAsync(user.Id, request.Email, token, t);
            if (dispatchJob is { } sent) await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['invitationDispatchState'],'"AcceptedByProvider"'::jsonb) WHERE id={sent}
                """, t);
            return new(user.Id, "AcceptedByProvider");
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            if (dispatchJob is { } pending) await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['invitationDispatchState'],'"PendingManualReview"'::jsonb) WHERE id={pending}
                """, t);
            return new(user.Id, "PendingManualReview");
        }
    }
    public async Task<bool> AcceptAsync(AcceptInvitationRequest request, CancellationToken t)
    {
        var candidate = await InvitationUserAsync(request.Token, t); if (candidate is null) return false;
        // Legacy clients may still send UserName. It can reject a mismatch, never select another account.
        if (!string.IsNullOrEmpty(request.UserName) && !string.Equals(candidate.UserName, request.UserName, StringComparison.OrdinalIgnoreCase)) return false;
        string token; try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token)); } catch (FormatException) { return false; }
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t); var grant = await identity.ResetGrantAsync(candidate.Id, t);
        if (user is null || !user.IsActive || user.EmailConfirmed || grant is null || grant.ConsumedAt is not null || grant.ExpiresAt <= sql.Now ||
            grant.TokenHash != IdentitySecurityStore.Hash(request.Token) || !await users.VerifyUserTokenAsync(user, TokenOptions.DefaultProvider, "AccountInvitation", token)) return false;
        var changed = await users.ResetPasswordAsync(user, await users.GeneratePasswordResetTokenAsync(user), request.NewPassword);
        if (!changed.Succeeded) return false;
        user.EmailConfirmed = true; if (!(await users.UpdateAsync(user)).Succeeded) return false;
        grant.ConsumedAt = sql.Now; await security.RevokeAllAsync(user.Id, "InvitationAccepted", t); security.Audit("AccountInvitationAccepted", true, user.Id);
        await identity.SaveChangesAsync(t); await tx.CommitAsync(t); return true;
    }

    private Task<ApplicationUser?> InvitationUserAsync(string token, CancellationToken t)
    {
        var hash = IdentitySecurityStore.Hash(token);
        return db.Users.AsNoTracking().SingleOrDefaultAsync(u => EF.Property<string>(u, "reset_token_hash") == hash, t);
    }

    public async Task<InvitationValidationResult> ValidateAsync(InvitationValidationRequest request, CancellationToken t)
    {
        var candidate = await InvitationUserAsync(request.Token, t);
        if (candidate is null) return new("Invalid");
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t);
        var grant = await identity.ResetGrantAsync(candidate.Id, t);
        if (user is null || grant is null || grant.TokenHash != IdentitySecurityStore.Hash(request.Token)) return new("Invalid");
        if (!user.IsActive) return new("Revoked");
        if (grant.ConsumedAt is not null) return new(user.EmailConfirmed ? "AlreadyActivated" : "Used");
        if (grant.ExpiresAt <= sql.Now) return new("Expired");
        string token;
        try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token)); }
        catch (FormatException) { return new("Invalid"); }
        if (!await users.VerifyUserTokenAsync(user, TokenOptions.DefaultProvider, "AccountInvitation", token)) return new("Revoked");
        if (user.EmailConfirmed) return new("AlreadyActivated");
        return new("Valid", user.Email);
    }

    private bool CoolingDown(PasswordResetGrant? grant) => grant is { ConsumedAt: null } && grant.ExpiresAt > sql.Now &&
        grant.ExpiresAt.AddMinutes(-options.Value.PasswordResetMinutes).AddSeconds(emailOptions.Value.ResendCooldownSeconds) > sql.Now;

    private async Task<string> InvitationToken(ApplicationUser user, CancellationToken t)
    {
        if (!(await users.UpdateSecurityStampAsync(user)).Succeeded) throw new NotificationException(409, "invitation_account_changed");
        await security.RevokeAllAsync(user.Id, "InvitationIssued", t);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GenerateUserTokenAsync(user, TokenOptions.DefaultProvider, "AccountInvitation")));
    }
}
