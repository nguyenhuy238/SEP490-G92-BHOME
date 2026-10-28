using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class JwtTokenIssuer(IOptions<JwtOptions> options, TimeProvider clock) : IAccessTokenIssuer
{
    public AccessToken Issue(Guid userId, IReadOnlyCollection<string> roles, Guid sessionId, string securityStamp, DateTimeOffset sessionExpiresAt)
    {
        if (userId == Guid.Empty || sessionId == Guid.Empty || string.IsNullOrWhiteSpace(securityStamp) ||
            roles.Count == 0 || roles.Any(role => !Roles.All.Contains(role)))
            throw new ArgumentException("A verified user and supported business roles are required.");

        var settings = options.Value;
        var now = clock.GetUtcNow();
        var expires = now.AddMinutes(settings.LifetimeMinutes);
        if (expires > sessionExpiresAt) expires = sessionExpiresAt;
        if (expires <= now) throw new ArgumentException("Session must not be expired.");
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("sid", sessionId.ToString()),
            new("sstamp", securityStamp)
        };
        claims.AddRange(roles.Distinct().Select(role => new Claim("role", role)));
        var token = new JwtSecurityToken(settings.Issuer, settings.Audience, claims,
            now.UtcDateTime, expires.UtcDateTime,
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                SecurityAlgorithms.HmacSha256));
        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}
