using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class AuthenticationSecurityTests(AuthenticationDatabaseFixture fixture) : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic!Password-493";
    private const string NewPassword = "Synthetic!Password-927";

    [Fact]
    public async Task AccountCreatedInactiveDoesNotAcquireDefaultActiveState()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid", IsActive = false };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, Roles.Owner)).Succeeded);
        using var client = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password })).StatusCode);
        await WithDb(async db => Assert.False((await db.Users.FindAsync(id))!.IsActive));
    }

    [Fact]
    public async Task RoleRemovalConcurrentWithRefreshCannotLeaveAnActiveSession()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        async Task RemoveRole()
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var stored = (await users.FindByIdAsync(user.Id.ToString()))!;
            Assert.True((await users.RemoveFromRoleAsync(stored, Roles.Owner)).Succeeded);
        }
        var refresh = client.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken });
        await Task.WhenAll(RemoveRole(), refresh);
        Assert.Contains((await refresh).StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });
        await WithDb(async db => Assert.NotNull((await db.AuthenticationSessions.FindAsync(session.SessionId))?.RevokedAt));
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("other-user")]
    [InlineData("malformed")]
    public async Task PasswordResetRejectsExpiredWrongOwnerAndMalformedToken(string failure)
    {
        var delivery = new CapturingTestDelivery();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await CreateUser();
        var otherUser = await CreateUser();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { user.UserName })).StatusCode);
        if (failure == "expired")
            await WithDb(db => db.PasswordResetGrants.Where(x => x.UserId == user.Id)
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow)));
        var response = await client.PostAsJsonAsync("/api/v1/auth/reset-password", new
        {
            userName = failure == "other-user" ? otherUser.UserName : user.UserName,
            token = failure == "malformed" ? "invalid!!!" : delivery.Tokens.Last(),
            newPassword = NewPassword
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await Login(client, user);
    }

    [Fact]
    public async Task ReadyResetDeliveryReturnsGenericResponseWithoutSendingForUnknownOrUnconfirmedAccount()
    {
        var delivery = new CapturingTestDelivery();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await CreateUser();
        await WithDb(db => db.Users.Where(x => x.Id == user.Id).ExecuteUpdateAsync(update => update.SetProperty(x => x.EmailConfirmed, false)));
        foreach (var name in new[] { user.UserName, Guid.NewGuid().ToString() })
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = name });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.DoesNotContain(name!, await response.Content.ReadAsStringAsync());
        }
        Assert.Empty(delivery.Tokens);
    }

    [Fact]
    public async Task AccountReactivationCannotResurrectOldSessionsAndChangesHaveAuditTargets()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        await WithDb(async db =>
        {
            await db.Users.Where(x => x.Id == user.Id).ExecuteUpdateAsync(update => update.SetProperty(x => x.IsActive, false));
            await db.Users.Where(x => x.Id == user.Id).ExecuteUpdateAsync(update => update.SetProperty(x => x.IsActive, true));
            Assert.True(await db.SecurityAudit.AnyAsync(x => x.TargetUserId == user.Id && x.Event == "AccountDeactivated" && x.UserId == null));
            Assert.True(await db.SecurityAudit.AnyAsync(x => x.TargetUserId == user.Id && x.Event == "AccountActivated"));
            Assert.NotNull((await db.AuthenticationSessions.FindAsync(session.SessionId))?.RevokedAt);
        });
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken })).StatusCode);
        await Login(client, user);
    }

    [Fact]
    public async Task RemovingAndRestoringRoleCannotResurrectOldSessions()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var stored = (await users.FindByIdAsync(user.Id.ToString()))!;
            Assert.True((await users.RemoveFromRoleAsync(stored, Roles.Owner)).Succeeded);
            Assert.True((await users.AddToRoleAsync(stored, Roles.Owner)).Succeeded);
        }
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        await WithDb(async db => Assert.True(await db.SecurityAudit.AnyAsync(x => x.TargetUserId == user.Id && x.Event == "RoleChanged")));
    }

    [Fact]
    public async Task CancellationBeforeRefreshOrPasswordChangeDoesNotMutateCredentials()
    {
        using var client = fixture.Factory.CreateClient();
        var user = await CreateUser();
        var session = await Login(client, user);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => scope.ServiceProvider.GetRequiredService<IAuthenticationSessions>()
            .RefreshAsync(session.RefreshToken!, cancellation.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => scope.ServiceProvider.GetRequiredService<IPasswordService>()
            .ChangeAsync(user.Id, session.SessionId, Password, NewPassword, cancellation.Token));
        await Refresh(client, session.RefreshToken!);
    }

    [Fact]
    public async Task LoginRefreshLogoutPersistsOnlyHashAndImmediatelyRejectsAccessToken()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        Assert.NotEqual(Guid.Empty, session.SessionId);
        Assert.NotNull(session.RefreshToken);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(session.AccessToken);
        Assert.Equal(user.Id.ToString(), jwt.Subject);
        Assert.Equal(session.SessionId.ToString(), jwt.Claims.Single(x => x.Type == "sid").Value);
        Assert.Contains(jwt.Claims, x => x.Type == "sstamp");
        Assert.Contains(jwt.Claims, x => x.Type == "jti");
        Assert.DoesNotContain(jwt.Claims, x => x.Type.Contains("location", StringComparison.OrdinalIgnoreCase) || x.Value == user.Email);
        Assert.InRange(session.SessionExpiresAt, DateTimeOffset.UtcNow.AddDays(6.99), DateTimeOffset.UtcNow.AddDays(7.01));
        await WithDb(async db =>
        {
            var stored = await db.RefreshTokens.SingleAsync(x => x.SessionId == session.SessionId);
            Assert.Equal(Hash(session.RefreshToken), stored.TokenHash);
            Assert.NotEqual(session.RefreshToken, stored.TokenHash);
            Assert.True(await db.SecurityAudit.AnyAsync(x => x.UserId == user.Id && x.Event == "LoginSucceeded"));
        });
        var refreshed = await Refresh(client, session.RefreshToken);
        Assert.Equal(session.SessionId, refreshed.SessionId);
        Assert.NotEqual(session.RefreshToken, refreshed.RefreshToken);
        Assert.Equal(session.SessionExpiresAt, refreshed.SessionExpiresAt);
        Bearer(client, refreshed);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshed.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task ReuseRevokesOnlyAffectedFamilyAndRecordsAudit()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var first = await Login(client, user);
        var other = await Login(client, user);
        var rotated = await Refresh(client, first.RefreshToken!);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { first.RefreshToken })).StatusCode);
        Bearer(client, rotated);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        Bearer(client, other);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { rotated.RefreshToken })).StatusCode);
        await Refresh(client, other.RefreshToken!);
        await WithDb(async db =>
        {
            Assert.True(await db.SecurityAudit.AnyAsync(x => x.SessionId == first.SessionId && x.Event == "RefreshTokenReuse"));
            Assert.Equal("RefreshTokenReuse", (await db.AuthenticationSessions.FindAsync(first.SessionId))?.RevocationReason);
        });
    }

    [Fact]
    public async Task ParallelRefreshConsumesTokenOnlyOnceAcrossIndependentRequests()
    {
        using var firstClient = fixture.Factory.CreateClient();
        using var secondClient = fixture.Factory.CreateClient();
        var session = await Login(firstClient, await CreateUser());
        var responses = await Task.WhenAll(
            firstClient.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken }),
            secondClient.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken }));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Unauthorized);
        await WithDb(async db =>
        {
            Assert.Equal(2, await db.RefreshTokens.CountAsync(x => x.SessionId == session.SessionId));
            Assert.Equal(1, await db.RefreshTokens.CountAsync(x => x.SessionId == session.SessionId && x.ConsumedAt != null));
            Assert.NotNull((await db.AuthenticationSessions.FindAsync(session.SessionId))?.RevokedAt);
        });
        var winner = (await responses.Single(x => x.StatusCode == HttpStatusCode.OK).Content.ReadFromJsonAsync<LoginResult>())!;
        Bearer(firstClient, winner);
        Assert.Equal(HttpStatusCode.Unauthorized, (await firstClient.GetAsync("/api/v1/auth/me")).StatusCode);
        firstClient.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await firstClient.PostAsJsonAsync("/api/v1/auth/refresh", new { winner.RefreshToken })).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LogoutCurrentAndAllDevicesApplyCorrectScope(bool allDevices)
    {
        var user = await CreateUser();
        using var first = fixture.Factory.CreateClient();
        using var second = fixture.Factory.CreateClient();
        var current = await Login(first, user);
        var other = await Login(second, user);
        Bearer(first, current);
        Bearer(second, other);
        Assert.Equal(HttpStatusCode.NoContent, (await first.PostAsJsonAsync(allDevices ? "/api/v1/auth/logout-all" : "/api/v1/auth/logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await first.GetAsync("/api/v1/session")).StatusCode);
        Assert.Equal(allDevices ? HttpStatusCode.Unauthorized : HttpStatusCode.OK, (await second.GetAsync("/api/v1/session")).StatusCode);
    }

    [Theory]
    [InlineData("inactive")]
    [InlineData("locked")]
    [InlineData("stamp")]
    [InlineData("role")]
    [InlineData("expired-session")]
    [InlineData("revoked-session")]
    [InlineData("two-factor")]
    public async Task CurrentServerStateRejectsPreviouslyValidJwt(string change)
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        await WithDb(async db =>
        {
            var stored = await db.Users.SingleAsync(x => x.Id == user.Id);
            if (change == "inactive") stored.IsActive = false;
            if (change == "locked") { stored.LockoutEnabled = true; stored.LockoutEnd = DateTimeOffset.UtcNow.AddMinutes(15); }
            if (change == "stamp") stored.SecurityStamp = Guid.NewGuid().ToString();
            if (change == "two-factor") stored.TwoFactorEnabled = true;
            if (change == "role") db.UserRoles.RemoveRange(await db.UserRoles.Where(x => x.UserId == user.Id).ToListAsync());
            var family = await db.AuthenticationSessions.SingleAsync(x => x.Id == session.SessionId);
            if (change == "expired-session") family.ExpiresAt = DateTimeOffset.UtcNow;
            if (change == "revoked-session") family.RevokedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        });
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task RefreshExpiryIsExclusiveAndDoesNotExtendAbsoluteLifetime()
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, await CreateUser());
        await WithDb(async db =>
        {
            var token = await db.RefreshTokens.SingleAsync(x => x.SessionId == session.SessionId);
            token.ExpiresAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task RefreshNearSevenDayDeadlineCannotExtendOrReviveTheSession()
    {
        var clock = new SessionTestClock(DateTimeOffset.UtcNow);
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<TimeProvider>(clock)));
        using var client = host.CreateClient();
        var session = await Login(client, await CreateUser());
        clock.UtcNow = session.SessionExpiresAt.AddMinutes(-1);
        var rotated = await Refresh(client, session.RefreshToken!);
        Assert.Equal(session.SessionExpiresAt, rotated.SessionExpiresAt);
        Assert.Equal(session.SessionExpiresAt, rotated.ExpiresAt);
        await WithDb(async db =>
        {
            var tokens = await db.RefreshTokens.Where(x => x.SessionId == session.SessionId).ToArrayAsync();
            Assert.Equal(2, tokens.Length);
            Assert.All(tokens, token => Assert.Equal(session.SessionExpiresAt, token.ExpiresAt));
        });
        clock.UtcNow = session.SessionExpiresAt;
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { rotated.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task ExpiredAccessTokenCanRefreshOnceAndUseTheNewAccessToken()
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, await CreateUser());
        using var scope = fixture.Factory.Services.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        var original = new JwtSecurityTokenHandler().ReadJwtToken(session.AccessToken);
        var claims = original.Claims.Where(x => x.Type is "sub" or "role" or "sid" or "sstamp" or "jti");
        var expired = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            settings.Issuer, settings.Audience, claims, DateTime.UtcNow.AddHours(-1), DateTime.UtcNow.AddMinutes(-1),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)), SecurityAlgorithms.HmacSha256)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", expired);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        var refreshed = await Refresh(client, session.RefreshToken!);
        Assert.Equal(session.SessionExpiresAt, refreshed.SessionExpiresAt);
        Assert.NotEqual(session.RefreshToken, refreshed.RefreshToken);
        Bearer(client, refreshed);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("synthetic-unknown-refresh-token")]
    public async Task InvalidRefreshCredentialDoesNotConsumeOrRevokeAValidSession(string? token)
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, await CreateUser());
        var response = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = token });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(session.RefreshToken!, body);
        await WithDb(async db =>
        {
            Assert.Null((await db.AuthenticationSessions.FindAsync(session.SessionId))?.RevokedAt);
            Assert.Null((await db.RefreshTokens.SingleAsync(x => x.SessionId == session.SessionId)).ConsumedAt);
        });
        await Refresh(client, session.RefreshToken!);
    }

    [Fact]
    public async Task RefreshConcurrentWithLogoutCannotLeaveValidFamily()
    {
        using var client = fixture.Factory.CreateClient();
        using var rotating = fixture.Factory.CreateClient();
        var session = await Login(client, await CreateUser());
        Bearer(client, session);
        var responses = await Task.WhenAll(
            client.PostAsJsonAsync("/api/v1/auth/logout", new { }),
            rotating.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken }));
        Assert.Equal(HttpStatusCode.NoContent, responses[0].StatusCode);
        Assert.Contains(responses[1].StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });
        await WithDb(async db => Assert.NotNull((await db.AuthenticationSessions.FindAsync(session.SessionId))?.RevokedAt));
        if (responses[1].StatusCode == HttpStatusCode.OK)
        {
            var result = (await responses[1].Content.ReadFromJsonAsync<LoginResult>())!;
            Bearer(rotating, result);
            Assert.Equal(HttpStatusCode.Unauthorized, (await rotating.GetAsync("/api/v1/auth/me")).StatusCode);
            rotating.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await rotating.PostAsJsonAsync("/api/v1/auth/refresh", new { result.RefreshToken })).StatusCode);
        }
    }

    [Theory]
    [InlineData("wrong")]
    [InlineData("weak")]
    [InlineData("valid")]
    public async Task ChangePasswordVerifiesCurrentPasswordPolicyAndRevokesEverySession(string scenario)
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        using var other = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        var otherSession = await Login(other, user);
        Bearer(client, session);
        Bearer(other, otherSession);
        var response = await client.PostAsJsonAsync("/api/v1/auth/change-password", new
        {
            currentPassword = scenario == "wrong" ? "wrong-password" : Password,
            newPassword = scenario == "weak" ? "aaaaaaaaaaaa" : NewPassword
        });
        Assert.Equal(scenario == "valid" ? HttpStatusCode.NoContent : HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(scenario == "valid" ? HttpStatusCode.Unauthorized : HttpStatusCode.OK, (await other.GetAsync("/api/v1/session")).StatusCode);
        if (scenario == "valid")
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = NewPassword })).StatusCode);
        }
    }

    [Fact]
    public async Task WebCookieIsPrivateAndOriginAndCustomHeaderAreRequired()
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("X-BHome-Client", "web");
        client.DefaultRequestHeaders.Add("Origin", "https://localhost");
        // Factory client defaults to http; configure same origin explicitly for this transport test.
        client.DefaultRequestHeaders.Remove("Origin");
        client.DefaultRequestHeaders.Add("Origin", "http://localhost");
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        Assert.Null(session.RefreshToken);
        var cookie = response.Headers.GetValues("Set-Cookie").Single();
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/v1/auth", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", cookie, StringComparison.OrdinalIgnoreCase);
        client.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { })).StatusCode);
        client.DefaultRequestHeaders.Remove("Origin");
        client.DefaultRequestHeaders.Add("Origin", "https://attacker.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { })).StatusCode);
        client.DefaultRequestHeaders.Remove("X-BHome-Client");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { })).StatusCode);
        // Cookies alone never authenticate a protected API.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task MissingResetDeliveryReturnsSameUnavailableForAnyAccount()
    {
        using var client = fixture.Factory.CreateClient();
        var user = await CreateUser();
        foreach (var name in new[] { user.UserName, Guid.NewGuid().ToString() })
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = name });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.DoesNotContain(name!, await response.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task ResetNewestTokenIsSingleUseAndRevokesSessionsUsingRealIdentityHasher()
    {
        var delivery = new CapturingTestDelivery();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await CreateUser();
        var session = await Login(client, user);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { user.UserName })).StatusCode);
        var first = delivery.Tokens.Last();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { user.UserName })).StatusCode);
        var latest = delivery.Tokens.Last();
        Assert.NotEqual(first, latest);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", new { user.UserName, token = first, newPassword = NewPassword })).StatusCode);
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { user.UserName, token = latest, newPassword = NewPassword })));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.NoContent);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.BadRequest);
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = NewPassword })).StatusCode);
        await WithDb(async db =>
        {
            var grant = await db.PasswordResetGrants.FindAsync(user.Id);
            Assert.Equal(Hash(latest), grant!.TokenHash);
            Assert.NotNull(grant.ConsumedAt);
        });
    }

    [Fact]
    public async Task FailedAuditWriteRollsBackRotationSoOriginalTokenCanBeRetried()
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, await CreateUser());
        await WithDb(db => db.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION auth_test_reject_refresh_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW."Event" = 'RefreshSucceeded' THEN RAISE EXCEPTION 'synthetic failure'; END IF;
                RETURN NEW;
            END; $$;
            CREATE TRIGGER auth_test_reject_refresh_audit BEFORE INSERT ON "SecurityAudit"
            FOR EACH ROW EXECUTE FUNCTION auth_test_reject_refresh_audit();
            """));
        try
        {
            var failed = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken });
            Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
            Assert.DoesNotContain(session.RefreshToken!, await failed.Content.ReadAsStringAsync());
            await WithDb(async db =>
            {
                var stored = await db.RefreshTokens.SingleAsync(x => x.SessionId == session.SessionId);
                Assert.Null(stored.ConsumedAt);
                Assert.Null(stored.ReplacedByTokenId);
            });
        }
        finally
        {
            await WithDb(db => db.Database.ExecuteSqlRawAsync("""
                DROP TRIGGER auth_test_reject_refresh_audit ON "SecurityAudit";
                DROP FUNCTION auth_test_reject_refresh_audit();
                """));
        }
        await Refresh(client, session.RefreshToken!);
    }

    [Fact]
    public async Task AuditRejectsUpdatesDeletesAndTruncateInDatabase()
    {
        using var client = fixture.Factory.CreateClient();
        await Login(client, await CreateUser());
        foreach (var sql in new[] { "UPDATE \"SecurityAudit\" SET \"Succeeded\" = false", "DELETE FROM \"SecurityAudit\"", "TRUNCATE \"SecurityAudit\"" })
            await WithDb(db => Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql)));
    }

    [Theory]
    [InlineData("signature")]
    [InlineData("expired")]
    [InlineData("issuer")]
    [InlineData("audience")]
    [InlineData("algorithm")]
    [InlineData("missing-session")]
    [InlineData("subject")]
    [InlineData("foreign-session")]
    [InlineData("role-escalation")]
    public async Task InvalidJwtCannotAccessProtectedApi(string invalid)
    {
        var user = await CreateUser();
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        using var scope = fixture.Factory.Services.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        var original = new JwtSecurityTokenHandler().ReadJwtToken(session.AccessToken);
        var claims = original.Claims.Where(x => x.Type is "sub" or "role" or "sid" or "sstamp" or "jti").ToList();
        if (invalid == "missing-session") claims.RemoveAll(x => x.Type == "sid");
        if (invalid == "subject") { claims.RemoveAll(x => x.Type == "sub"); claims.Add(new Claim("sub", Guid.NewGuid().ToString())); }
        if (invalid == "foreign-session") { claims.RemoveAll(x => x.Type == "sid"); claims.Add(new Claim("sid", Guid.NewGuid().ToString())); }
        if (invalid == "role-escalation") claims.Add(new Claim("role", Roles.Staff));
        var encoded = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            invalid == "issuer" ? "wrong-issuer" : settings.Issuer,
            invalid == "audience" ? "wrong-audience" : settings.Audience, claims,
            DateTime.UtcNow.AddHours(-1), invalid == "expired" ? DateTime.UtcNow.AddMinutes(-5) : DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(invalid == "signature" ? RandomNumberGenerator.GetBytes(64) : Encoding.UTF8.GetBytes(settings.SigningKey)),
                invalid == "algorithm" ? SecurityAlgorithms.HmacSha384 : SecurityAlgorithms.HmacSha256)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", encoded);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
    }

    private async Task<ApplicationUser> CreateUser()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid", EmailConfirmed = true, LockoutEnabled = true };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, Roles.Owner)).Succeeded);
        return user;
    }

    private static async Task<LoginResult> Login(HttpClient client, ApplicationUser user)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResult>())!;
    }

    private static async Task<LoginResult> Refresh(HttpClient client, string token)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = token });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResult>())!;
    }

    private static void Bearer(HttpClient client, LoginResult session) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private async Task WithDb(Func<BHomeDbContext, Task> test)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        await test(scope.ServiceProvider.GetRequiredService<BHomeDbContext>());
    }

    private sealed class SessionTestClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    // Test-only delivery boundary: never registered by the shipped application.
    private sealed class CapturingTestDelivery : IPasswordResetDelivery
    {
        public bool IsAvailable => true;
        public List<string> Tokens { get; } = [];
        public Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken)
        {
            Tokens.Add(token);
            return Task.CompletedTask;
        }
    }
}
