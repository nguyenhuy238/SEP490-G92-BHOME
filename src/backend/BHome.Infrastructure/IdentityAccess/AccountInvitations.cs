using System.Security.Cryptography;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
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

    public async Task<TenantInvitationResult> InviteStaffAsync(Guid userId, CancellationToken t)
    {
        if (actor.UserId is null || !actor.IsInRole(Roles.Owner)) throw new NotificationException(403, "invitation_owner_required");
        if (!delivery.IsAvailable) throw new BHome.Application.Common.IntegrationUnavailableException("Account invitation email is not configured.");
        await using var tx = await identity.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(userId, t);
        if (user is null || !user.IsActive || !(await security.RolesAsync(userId, t)).Contains(Roles.Staff)) throw new NotificationException(404, "staff_not_found");
        if (user.EmailConfirmed || string.IsNullOrWhiteSpace(user.Email)) throw new NotificationException(409, "account_not_eligible_for_invitation");
        var grant = await identity.ResetGrantAsync(user.Id, t);
        if (CoolingDown(grant)) return new(user.Id, "ExistingInvitationPreserved");
        var token = await InvitationToken(user, t);
        if (grant is null) { grant = new PasswordResetGrant { UserId = user.Id }; identity.AddResetGrant(grant); }
        grant.TokenHash = IdentitySecurityStore.Hash(token); grant.ExpiresAt = sql.Now.AddMinutes(options.Value.PasswordResetMinutes); grant.ConsumedAt = null;
        security.Audit("AccountInvitationCreated", true, user.Id);
        if (delivery.IsDurable) await delivery.QueueAsync(new(user.Id, user.Email, token, grant.ExpiresAt, "StaffInvitation"), t);
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
        if (!delivery.IsAvailable) throw new BHome.Application.Common.IntegrationUnavailableException("Account invitation email is not configured.");
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
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N"),
                LockoutEnabled = true
            };
            db.Users.Add(user); db.Entry(user).Property("roles").CurrentValue = new[] { Roles.Tenant };
            // Unknowable random initial credential; no default password is issued to the user.
            user.PasswordHash = users.PasswordHasher.HashPassword(user, Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)) + "!aA1");
            user.NormalizedUserName = users.NormalizeName(user.UserName); user.NormalizedEmail = users.NormalizeEmail(user.Email);
            await db.SaveChangesAsync(t);
            await sql.Execute("UPDATE residents SET user_id=@user WHERE id=@resident AND user_id IS NULL", t, ("user", id), ("resident", residentId));
        }
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
            await delivery.QueueAsync(new(user.Id, request.Email, token, grant.ExpiresAt, "TenantInvitation"), t);
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
        var candidate = await users.FindByNameAsync(request.UserName); if (candidate is null) return false;
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

    private bool CoolingDown(PasswordResetGrant? grant) => grant is { ConsumedAt: null } && grant.ExpiresAt > sql.Now &&
        grant.ExpiresAt.AddMinutes(-options.Value.PasswordResetMinutes).AddSeconds(emailOptions.Value.ResendCooldownSeconds) > sql.Now;

    private async Task<string> InvitationToken(ApplicationUser user, CancellationToken t)
    {
        if (!(await users.UpdateSecurityStampAsync(user)).Succeeded) throw new NotificationException(409, "invitation_account_changed");
        await security.RevokeAllAsync(user.Id, "InvitationIssued", t);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GenerateUserTokenAsync(user, TokenOptions.DefaultProvider, "AccountInvitation")));
    }
}
