using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;

namespace BHome.IntegrationTests;

internal static class TestAuthResponse
{
    public static async Task<LoginResult> ReadAsync(HttpContent content, DateTimeOffset? sessionExpiresAt = null)
    {
        var transport = await content.ReadFromJsonAsync<AuthTransportResponse>()
            ?? throw new InvalidOperationException("Authentication response was empty.");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(transport.AccessToken);
        var userId = Guid.Parse(jwt.Subject);
        var sessionId = Guid.Parse(jwt.Claims.Single(claim => claim.Type == "sid").Value);
        var roles = jwt.Claims.Where(claim => claim.Type == "role").Select(claim => claim.Value).ToArray();
        var expiresAt = new DateTimeOffset(DateTime.SpecifyKind(jwt.ValidTo, DateTimeKind.Utc));
        return new LoginResult(userId, roles, transport.AccessToken, expiresAt, sessionId,
            transport.RefreshToken, sessionExpiresAt ?? default);
    }

    private sealed record AuthTransportResponse(string AccessToken, string? RefreshToken);
}
