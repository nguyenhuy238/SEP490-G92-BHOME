using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.IntegrationTests;

// Real issuer and bearer middleware; the session port is substituted, not the database implementation.
public sealed class JwtAuthenticationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void IssuerUsesThirtyMinutesAndCapsExpiryAtTheSessionDeadline(bool nearSessionExpiry)
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var issuer = scope.ServiceProvider.GetRequiredService<IAccessTokenIssuer>();
        Assert.Equal(30, scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value.LifetimeMinutes);
        var before = DateTimeOffset.UtcNow;
        var deadline = before.AddMinutes(nearSessionExpiry ? 5 : 60);
        var access = issuer.Issue(Guid.NewGuid(), [Roles.Staff], Guid.NewGuid(), "synthetic-stamp", deadline);
        if (nearSessionExpiry) Assert.Equal(deadline, access.ExpiresAt);
        else Assert.InRange(access.ExpiresAt, before.AddMinutes(30), DateTimeOffset.UtcNow.AddMinutes(30));
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(access.Value);
        Assert.Equal(SecurityAlgorithms.HmacSha256, jwt.Header.Alg);
        Assert.DoesNotContain(jwt.Claims, claim => claim.Type is "email" or "locationId");
    }

    [Fact]
    public async Task EveryBearerRequestRevalidatesTheSessionInsteadOfCachingPermission()
    {
        using var factory = new ApiFactory();
        var sessions = new TestSessions();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<IAuthenticationSessions>(sessions)));
        using var scope = host.Services.CreateScope();
        var token = scope.ServiceProvider.GetRequiredService<IAccessTokenIssuer>()
            .Issue(sessions.UserId, [Roles.Staff], sessions.SessionId, "synthetic-stamp", DateTimeOffset.UtcNow.AddDays(1));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Value);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/session")).StatusCode);
        sessions.Eligible = false;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(3, sessions.Validations);
    }

    [Theory]
    [InlineData("signature")]
    [InlineData("issuer")]
    [InlineData("audience")]
    [InlineData("expired")]
    [InlineData("algorithm")]
    public async Task InvalidJwtIsRejectedBeforeSessionLookup(string failure)
    {
        using var factory = new ApiFactory();
        var sessions = new TestSessions();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<IAuthenticationSessions>(sessions)));
        using var scope = host.Services.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        Claim[] claims = [new("sub", sessions.UserId.ToString()), new("sid", sessions.SessionId.ToString()),
            new("sstamp", "synthetic-stamp"), new("jti", Guid.NewGuid().ToString()), new("role", Roles.Staff)];
        var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            failure == "issuer" ? "wrong-issuer" : options.Issuer,
            failure == "audience" ? "wrong-audience" : options.Audience, claims,
            DateTime.UtcNow.AddHours(-1), failure == "expired" ? DateTime.UtcNow.AddMinutes(-5) : DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(failure == "signature"
                ? RandomNumberGenerator.GetBytes(64) : Encoding.UTF8.GetBytes(options.SigningKey)),
                failure == "algorithm" ? SecurityAlgorithms.HmacSha384 : SecurityAlgorithms.HmacSha256)));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        Assert.Equal(0, sessions.Validations);
    }

    private sealed class TestSessions : IAuthenticationSessions
    {
        public Guid UserId { get; } = Guid.NewGuid();
        public Guid SessionId { get; } = Guid.NewGuid();
        public bool Eligible { get; set; } = true;
        public int Validations { get; private set; }
        public Task<bool> ValidateAsync(SessionIdentity identity, string securityStamp, CancellationToken cancellationToken)
        {
            Validations++;
            return Task.FromResult(Eligible && identity.UserId == UserId && identity.SessionId == SessionId &&
                securityStamp == "synthetic-stamp" && identity.Roles.SequenceEqual([Roles.Staff]));
        }
        public Task<LoginResult?> CreateAsync(VerifiedIdentity identity, string? device, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
        public Task<LoginResult?> RefreshAsync(string token, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task RevokeAsync(Guid userId, Guid sessionId, bool allDevices, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
