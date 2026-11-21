using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24SessionLifecycleTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private async Task<ApplicationUser> User()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var email = Guid.NewGuid().ToString("N") + "@example.invalid";
        return await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true }, "Tenant", WorkflowTestUsers.Password);
    }
    private static async Task<LoginResult> Login(HttpClient client, ApplicationUser user)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = WorkflowTestUsers.Password });
        response.EnsureSuccessStatusCode(); return await TestAuthResponse.ReadAsync(response.Content);
    }
    private static void Bearer(HttpClient client, LoginResult session) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);

    [CompactPostgresFact]
    public async Task ExpiredThirtyMinuteAccessRefreshesWithinSevenDayDeadlineAndOldRefreshReplayRevokesTheFamily()
    {
        var user = await User(); var clock = new Clock { Now = DateTimeOffset.UtcNow.AddHours(-1) };
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        using var client = host.CreateClient(); var first = await Login(client, user); Bearer(client, first);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(first.AccessToken);
        Assert.InRange(jwt.ValidTo - clock.Now.UtcDateTime, TimeSpan.FromMinutes(30).Subtract(TimeSpan.FromSeconds(1)), TimeSpan.FromMinutes(30));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var deadline = await db.Database.SqlQuery<DateTimeOffset>($"SELECT expires_at AS \"Value\" FROM refresh_tokens WHERE id={first.SessionId}").SingleAsync();
        Assert.InRange(deadline - clock.Now, TimeSpan.FromDays(7).Subtract(TimeSpan.FromSeconds(1)), TimeSpan.FromDays(7));
        clock.Now = DateTimeOffset.UtcNow;
        var refreshed = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = first.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode); var next = await TestAuthResponse.ReadAsync(refreshed.Content);
        Bearer(client, next); Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(deadline, await db.Database.SqlQuery<DateTimeOffset>($"SELECT expires_at AS \"Value\" FROM refresh_tokens WHERE id={first.SessionId}").SingleAsync());
        var hashes = await db.Database.SqlQuery<string>($"SELECT token_hash AS \"Value\" FROM refresh_tokens WHERE user_id={user.Id} AND token_hash IS NOT NULL").ToArrayAsync();
        Assert.All(hashes, hash => Assert.Equal(64, hash.Length));
        Assert.True(hashes.All(hash => hash != first.RefreshToken && hash != next.RefreshToken), "Only refresh credential hashes may be persisted.");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = first.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task LogoutOneDeviceLeavesTheOtherSessionActiveAndForgedOwnerRoleIsRejected()
    {
        var user = await User(); using var a = fixture.Factory!.CreateClient(); using var b = fixture.Factory.CreateClient();
        var first = await Login(a, user); var second = await Login(b, user); Bearer(a, first); Bearer(b, second);
        Assert.Equal(HttpStatusCode.Forbidden, (await b.GetAsync("/api/v1/staff")).StatusCode);
        var pieces = second.AccessToken.Split('.');
        var payload = System.Text.Encoding.UTF8.GetString(Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlDecode(pieces[1]));
        pieces[1] = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(payload.Replace("Tenant", "Owner")));
        b.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", string.Join('.', pieces));
        Assert.Equal(HttpStatusCode.Unauthorized, (await b.GetAsync("/api/v1/staff")).StatusCode); Bearer(b, second);
        Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsync("/api/v1/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await a.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/api/v1/auth/me")).StatusCode);
    }
}
