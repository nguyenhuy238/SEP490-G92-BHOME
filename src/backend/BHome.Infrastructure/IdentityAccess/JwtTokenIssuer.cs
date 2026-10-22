using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class JwtTokenIssuer(IOptions<JwtOptions> options) : IAccessTokenIssuer
{
    public AccessToken Issue(Guid userId, IReadOnlyCollection<string> roles)
    {
        if (userId == Guid.Empty || roles.Count == 0 || roles.Any(role => !Roles.All.Contains(role)))
            throw new ArgumentException("A verified user and supported business roles are required.");

        var settings = options.Value;
        var now = DateTimeOffset.UtcNow;
        var expires = now.AddMinutes(settings.LifetimeMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        claims.AddRange(roles.Distinct().Select(role => new Claim("role", role)));
        var token = new JwtSecurityToken(settings.Issuer, settings.Audience, claims,
            now.UtcDateTime, expires.UtcDateTime,
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                SecurityAlgorithms.HmacSha256));
        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}
