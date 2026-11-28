using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentitySessionService(IIdentityPersistence db, IdentitySecurityStore security,
    IAccessTokenIssuer issuer, IOptions<SessionOptions> options, TimeProvider clock) : IAuthenticationSessions
{
    public async Task<LoginResult?> CreateAsync(VerifiedIdentity identity, string? device, CancellationToken cancellationToken)
    {
        await using var transaction = await db.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(identity.UserId, cancellationToken);
        var roles = await security.RolesAsync(identity.UserId, cancellationToken);
        if (user is null || !security.IsEligible(user) || user.SecurityStamp != identity.SecurityStamp ||
            !IdentitySecurityStore.SupportedRoles(roles) || !roles.ToHashSet().SetEquals(identity.Roles))
        {
            security.Audit("LoginFailed", false);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return null;
        }
        var now = clock.GetUtcNow();
        // PostgreSQL timestamptz stores microseconds; return exactly the persisted absolute expiry.
        now = now.AddTicks(-(now.Ticks % 10));
        var session = new AuthenticationSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            SecurityStamp = user.SecurityStamp!,
            Device = string.IsNullOrWhiteSpace(device) ? null : device[..Math.Min(device.Length, 256)],
            CreatedAt = now,
            LastActivityAt = now,
            ExpiresAt = now.AddDays(options.Value.AbsoluteLifetimeDays)
        };
        db.AddSession(session);
        var result = Issue(session, roles);
        security.Audit("LoginSucceeded", true, user.Id, session.Id);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<LoginResult?> RefreshAsync(string token, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(token) || token.Length > 256) return null;
        var hash = IdentitySecurityStore.Hash(token);
        var ownerId = await db.TokenOwnerAsync(hash, cancellationToken);
        if (ownerId is null) return null;

        await using var transaction = await db.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(ownerId.Value, cancellationToken);
        var stored = await db.TokenAsync(hash, cancellationToken);
        var family = await db.SessionAsync(stored.SessionId, null, cancellationToken) ?? throw new InvalidOperationException("Session missing.");
        var now = clock.GetUtcNow();
        var roles = await security.RolesAsync(ownerId.Value, cancellationToken);
        LoginResult? result = null;
        if (family.RevokedAt is null && stored.ConsumedAt is not null)
        {
            family.RevokedAt = now;
            family.RevocationReason = "RefreshTokenReuse";
            security.Audit("RefreshTokenReuse", false, family.UserId, family.Id);
        }
        else if (user is not null && security.IsEligible(user) && family.RevokedAt is null &&
            stored.ExpiresAt > now && family.ExpiresAt > now && family.SecurityStamp == user.SecurityStamp &&
            IdentitySecurityStore.SupportedRoles(roles))
        {
            stored.ConsumedAt = now;
            family.LastActivityAt = now;
            result = Issue(family, roles);
            stored.ReplacedByTokenId = db.IssuedTokenId(IdentitySecurityStore.Hash(result.RefreshToken!));
            security.Audit("RefreshSucceeded", true, family.UserId, family.Id);
        }
        else security.Audit("RefreshDenied", false, family.UserId, family.Id);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task RevokeAsync(Guid userId, Guid sessionId, bool allDevices, CancellationToken cancellationToken)
    {
        await using var transaction = await db.BeginTransactionAsync(cancellationToken);
        var user = await security.LockUserAsync(userId, cancellationToken);
        if (user is null) return;
        if (allDevices) await security.RevokeAllAsync(userId, "LogoutAll", cancellationToken);
        else
        {
            var session = await db.SessionAsync(sessionId, userId, cancellationToken);
            if (session is null) return;
            session.RevokedAt ??= clock.GetUtcNow();
            session.RevocationReason ??= "Logout";
        }
        security.Audit(allDevices ? "LogoutAll" : "Logout", true, userId, sessionId);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> ValidateAsync(SessionIdentity identity, string securityStamp, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var valid = await db.ValidSessionAsync(identity, securityStamp, now, cancellationToken);
        if (!valid) return false;
        var roles = await security.RolesAsync(identity.UserId, cancellationToken);
        if (!IdentitySecurityStore.SupportedRoles(roles) || !roles.ToHashSet().SetEquals(identity.Roles)) return false;
        var updated = await db.TouchSessionAsync(identity.SessionId, now, cancellationToken);
        return updated == 1;
    }

    private LoginResult Issue(AuthenticationSession session, string[] roles)
    {
        var now = clock.GetUtcNow();
        var raw = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var expires = now.AddDays(options.Value.RefreshTokenDays);
        db.AddToken(new RefreshTokenRecord
        {
            Id = Guid.NewGuid(),
            SessionId = session.Id,
            TokenHash = IdentitySecurityStore.Hash(raw),
            CreatedAt = now,
            ExpiresAt = expires < session.ExpiresAt ? expires : session.ExpiresAt
        });
        var access = issuer.Issue(session.UserId, roles, session.Id, session.SecurityStamp, session.ExpiresAt);
        return new LoginResult(session.UserId, roles, access.Value, access.ExpiresAt, session.Id, raw, session.ExpiresAt);
    }
}
