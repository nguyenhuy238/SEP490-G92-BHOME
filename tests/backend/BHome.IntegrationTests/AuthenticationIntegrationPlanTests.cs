using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

// Report 5.2 - Integration Test, sheet "Authentication" (IT-AUTH-*, 33 test cases).
// Expected results come from SRS v1.3 (FE-02 §2.1.1 Sign In / Sign Out, §2.2.1 Profile, NFR §2.3 Security,
// UC-01..03, GBR-01/02, MSG17) and, where the SRS is silent, from the test plan itself ("Basis: plan").
// The source code was only read to learn the routes and how to call them. A failing test is a candidate
// defect to report in the sheet, not a test to "fix" by copying what the code does.
[Trait("Category", "Docker")]
[Trait("Suite", "Report-5.2-Authentication")]
public sealed class AuthenticationIntegrationPlanTests(AuthenticationDatabaseFixture fixture)
    : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic!Plan-Password-482";
    private const string NewPassword = "Synthetic!Plan-Password-917";
    // SRS v1.3 Appendix MSG17 (Sign in, generic error) and §2.1.1 "Error Message".
    private const string Msg17 = "Incorrect login information or account unavailable. Please try again.";

    // ───────────── User Sign-In: POST /api/v1/auth/login (UC-01, SRS §2.1.1) ─────────────

    [Theory]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-001")]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-002")]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-003")]
    [InlineData(Roles.Owner)]   // IT-AUTH-LOGIN-001
    [InlineData(Roles.Staff)]   // IT-AUTH-LOGIN-002
    [InlineData(Roles.Tenant)]  // IT-AUTH-LOGIN-003
    public async Task IT_AUTH_LOGIN_001_003_ActiveAccountSignsInWithOnlyItsOwnRole(string role)
    {
        // Basis: UC-01 (sign in, access by role), GBR-01 (fixed roles); plan: token pair + persisted session.
        var user = await CreateUser(role);
        using var client = fixture.Factory.CreateClient();
        var response = await PostLogin(client, user.Email!, Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        Assert.False(string.IsNullOrWhiteSpace(session.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(session.RefreshToken));
        Assert.Equal([role], session.Roles);
        await WithDb(async db => Assert.True(await db.AuthenticationSessions
            .AnyAsync(x => x.Id == session.SessionId && x.UserId == user.Id && x.RevokedAt == null)));

        Bearer(client, session);
        var me = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var identity = (await me.Content.ReadFromJsonAsync<SessionIdentity>())!;
        Assert.Equal([role], identity.Roles);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-004")]
    public async Task IT_AUTH_LOGIN_004_WrongPasswordIsRejectedWithGenericMessage()
    {
        // Basis: SRS §2.1.1 + MSG17 (generic message); plan: AccessFailedCount +1, no token.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var response = await PostLogin(client, user.Email!, "Wrong!Password-000");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("accessToken", body, StringComparison.OrdinalIgnoreCase);
        await WithDb(async db => Assert.Equal(1, (await db.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id)).AccessFailedCount));
        await AssertMsg17(response);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-005")]
    public async Task IT_AUTH_LOGIN_005_UnknownEmailGetsTheSameAnswerAsWrongPassword()
    {
        // Basis: SRS §2.1.1 generic error; the answer must not reveal whether the account exists.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var wrongPassword = await PostLogin(client, user.Email!, "Wrong!Password-000");
        var unknown = await PostLogin(client, $"ghost-{Guid.NewGuid():N}@example.invalid", "Wrong!Password-000");

        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(wrongPassword.StatusCode, unknown.StatusCode);
        Assert.Equal(await ProblemTitle(wrongPassword), await ProblemTitle(unknown));
        await AssertMsg17(unknown);
    }

    [Theory]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-006")]
    [InlineData("inactive")]
    [InlineData("locked")]
    [InlineData("no-role")]
    public async Task IT_AUTH_LOGIN_006_UnavailableAccountIsRejectedWithoutSession(string state)
    {
        // Basis: SRS §2.1.1 "account is unavailable" -> generic message (MSG17); plan: no session/token.
        var user = await CreateUser(state == "no-role" ? null : Roles.Owner);
        if (state == "inactive")
            await WithDb(db => db.Users.Where(x => x.Id == user.Id).ExecuteUpdateAsync(u => u.SetProperty(x => x.IsActive, false)));
        if (state == "locked")
            await WithDb(db => db.Users.Where(x => x.Id == user.Id)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.LockoutEnd, DateTimeOffset.UtcNow.AddHours(1))));
        using var client = fixture.Factory.CreateClient();
        var response = await PostLogin(client, user.Email!, Password);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await WithDb(async db => Assert.False(await db.AuthenticationSessions.AnyAsync(x => x.UserId == user.Id)));
        await AssertMsg17(response);
    }

    [Theory]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-007")]
    [InlineData(null, Password)]
    [InlineData("", Password)]
    [InlineData("abc", Password)]
    [InlineData("valid@example.invalid", null)]
    public async Task IT_AUTH_LOGIN_007_MissingOrMalformedInputIsRejected(string? email, string? password)
    {
        // Basis: plan (HTTP 400, rejected by validation, no session). The SRS has no validation message.
        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("accessToken", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-008")]
    public async Task IT_AUTH_LOGIN_008_FiveWrongPasswordsLockTheAccountFor15Minutes()
    {
        // Basis: plan (5 attempts, 15 minutes). The SRS only requires the generic message (MSG17).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        for (var attempt = 0; attempt < 5; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostLogin(client, user.Email!, "Wrong!Password-000")).StatusCode);

        await WithDb(async db =>
        {
            var lockoutEnd = (await db.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id)).LockoutEnd;
            Assert.NotNull(lockoutEnd);
            Assert.InRange(lockoutEnd!.Value, DateTimeOffset.UtcNow.AddMinutes(14), DateTimeOffset.UtcNow.AddMinutes(16));
        });
        var correct = await PostLogin(client, user.Email!, Password);
        Assert.Equal(HttpStatusCode.Unauthorized, correct.StatusCode);
        await AssertMsg17(correct);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-009")]
    public async Task IT_AUTH_LOGIN_009_SignInIsLimitedTo30RequestsPerMinuteAndSpoofedHeadersDoNotHelp()
    {
        // Basis: plan (30 requests / 60 seconds, HTTP 429, X-Forwarded-For is not trusted).
        using var host = fixture.Factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AuthRateLimit:PermitLimit"] = "30",
                ["AuthRateLimit:WindowSeconds"] = "60"
            })));
        using var client = host.CreateClient();
        for (var attempt = 1; attempt <= 31; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
            {
                Content = JsonContent.Create(new { email = "rate-limit@example.invalid", password = "Wrong!Password-000" })
            };
            request.Headers.Add("X-Forwarded-For", $"198.51.100.{attempt}");
            var response = await client.SendAsync(request);
            Assert.Equal(attempt <= 30 ? HttpStatusCode.Unauthorized : HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-010")]
    public async Task IT_AUTH_LOGIN_010_EmailIsCaseInsensitiveAndUserNameIsNotAnEmail()
    {
        // Basis: SRS §2.1.1 (identifier = registered email or phone number); plan: user name -> HTTP 400.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await PostLogin(client, user.Email!.ToUpperInvariant(), Password)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostLogin(client, user.UserName!, Password)).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-011")]
    public async Task IT_AUTH_LOGIN_011_LegacyPayloadWithoutEmailIsRejected()
    {
        // Basis: plan (HTTP 400, no session).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { userName = user.UserName, password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await WithDb(async db => Assert.False(await db.AuthenticationSessions.AnyAsync(x => x.UserId == user.Id)));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-012")]
    public async Task IT_AUTH_LOGIN_012_DuplicateNormalizedEmailIsDeniedWithoutSession()
    {
        // Basis: plan (HTTP 401 generic, no session); message per SRS MSG17.
        var first = await CreateUser(Roles.Owner);
        var second = await CreateUser(Roles.Staff);
        await WithDb(db => db.Users.Where(x => x.Id == second.Id).ExecuteUpdateAsync(u => u
            .SetProperty(x => x.Email, first.Email)
            .SetProperty(x => x.NormalizedEmail, first.Email!.ToUpperInvariant())));
        using var client = fixture.Factory.CreateClient();
        var response = await PostLogin(client, first.Email!, Password);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await WithDb(async db => Assert.False(await db.AuthenticationSessions.AnyAsync(x => x.UserId == first.Id || x.UserId == second.Id)));
        await AssertMsg17(response);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGIN-013")]
    public async Task IT_AUTH_LOGIN_013_RegisteredPhoneNumberCanSignIn()
    {
        // Basis: SRS §2.1.1 "Login Identifier: Registered email address or phone number".
        var user = await CreateUser(Roles.Owner);
        var phone = "09" + Random.Shared.Next(10_000_000, 99_999_999);
        await WithDb(db => db.Users.Where(x => x.Id == user.Id).ExecuteUpdateAsync(u => u
            .SetProperty(x => x.PhoneNumber, phone).SetProperty(x => x.PhoneNumberConfirmed, true)));
        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { phoneNumber = phone, password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        await WithDb(async db => Assert.True(await db.AuthenticationSessions.AnyAsync(x => x.Id == session.SessionId && x.UserId == user.Id)));
    }

    // ───────────── Current Account Identity: GET /api/v1/auth/me (NFR §2.3) ─────────────

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-ME-001")]
    public async Task IT_AUTH_ME_001_SignedInUserReadsOwnIdentityWithoutSecrets()
    {
        // Basis: NFR §2.3 Authentication / Password Protection; plan: userId, email, roles, sessionId.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        Bearer(client, session);
        var response = await client.GetAsync("/api/v1/auth/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        Assert.Equal(user.Id, json.RootElement.GetProperty("userId").GetGuid());
        Assert.Equal(session.SessionId, json.RootElement.GetProperty("sessionId").GetGuid());
        Assert.Equal(Roles.Owner, json.RootElement.GetProperty("roles")[0].GetString());
        Assert.True(json.RootElement.TryGetProperty("email", out var email), "Plan: /me returns the email.");
        Assert.Equal(user.Email, email.GetString());
        Assert.DoesNotContain("passwordHash", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Password, body, StringComparison.Ordinal);
        Assert.DoesNotContain(session.RefreshToken!, body, StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-ME-002")]
    public async Task IT_AUTH_ME_002_RequestWithoutTokenIsRejected()
    {
        // Basis: NFR §2.3 Authentication (protected operations require an authenticated account).
        using var client = fixture.Factory.CreateClient();
        var response = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.DoesNotContain("userId", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-ME-003")]
    public async Task IT_AUTH_ME_003_ExpiredAccessTokenIsRejected()
    {
        // Basis: NFR §2.3 Authentication; plan: expired token -> HTTP 401.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ResignedToken(session.AccessToken,
            notBefore: DateTime.UtcNow.AddHours(-2), expires: DateTime.UtcNow.AddMinutes(-1)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-ME-004")]
    public async Task IT_AUTH_ME_004_TamperedRoleClaimIsRejected()
    {
        // Basis: NFR §2.3 Authorization (server-side role enforcement), GBR-01.
        var user = await CreateUser(Roles.Tenant);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        var parts = session.AccessToken.Split('.');
        var payload = Encoding.UTF8.GetString(Base64UrlDecode(parts[1])).Replace($"\"{Roles.Tenant}\"", $"\"{Roles.Owner}\"");
        Assert.Contains($"\"{Roles.Owner}\"", payload);
        var tampered = $"{parts[0]}.{Base64UrlEncode(Encoding.UTF8.GetBytes(payload))}.{parts[2]}";
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tampered);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-ME-005")]
    public async Task IT_AUTH_ME_005_RotatedSecurityStampInvalidatesTheToken()
    {
        // Basis: NFR §2.3 Authentication; plan: SecurityStamp changed in DB -> HTTP 401.
        var user = await CreateUser(Roles.Staff);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.UpdateSecurityStampAsync((await users.FindByIdAsync(user.Id.ToString()))!)).Succeeded);
        }
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    // ───────────── Refresh Token Rotation: POST /api/v1/auth/refresh ─────────────

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-REFRESH-001")]
    public async Task IT_AUTH_REFRESH_001_RefreshRotatesTokenAndIssuesNewAccessToken()
    {
        // Basis: plan (new access token, rotated RT-02, RT-01 consumed/replaced in DB).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var first = await Login(client, user);
        var response = await PostRefresh(client, first.RefreshToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var second = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        Assert.NotEqual(first.AccessToken, second.AccessToken);
        await WithDb(async db =>
        {
            var tokens = await db.RefreshTokens.AsNoTracking().Where(x => x.SessionId == first.SessionId).ToListAsync();
            Assert.Equal(2, tokens.Count);
            Assert.Single(tokens, x => x.ConsumedAt != null && x.ReplacedByTokenId != null);
        });
        Bearer(client, second);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-REFRESH-002")]
    public async Task IT_AUTH_REFRESH_002_ReusedRefreshTokenRevokesTheWholeFamily()
    {
        // Basis: plan (replay of RT-01 -> 401, RT-02 -> 401, family revoked in DB).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var first = await Login(client, user);
        var second = (await (await PostRefresh(client, first.RefreshToken)).Content.ReadFromJsonAsync<LoginResult>())!;

        Assert.Equal(HttpStatusCode.Unauthorized, (await PostRefresh(client, first.RefreshToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostRefresh(client, second.RefreshToken)).StatusCode);
        await WithDb(async db => Assert.NotNull((await db.AuthenticationSessions.AsNoTracking().SingleAsync(x => x.Id == first.SessionId)).RevokedAt));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-REFRESH-003")]
    public async Task IT_AUTH_REFRESH_003_ConcurrentRefreshSucceedsExactlyOnce()
    {
        // Basis: plan (exactly one 200, the other 401, no duplicate tokens).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        var results = await Task.WhenAll(PostRefresh(client, session.RefreshToken), PostRefresh(client, session.RefreshToken));

        Assert.Equal(1, results.Count(x => x.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, results.Count(x => x.StatusCode == HttpStatusCode.Unauthorized));
        await WithDb(async db => Assert.True(await db.RefreshTokens.CountAsync(x => x.SessionId == session.SessionId) <= 2));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-REFRESH-004")]
    public async Task IT_AUTH_REFRESH_004_UnknownOrMissingRefreshTokenIsRejectedWithoutTouchingSessions()
    {
        // Basis: plan (HTTP 401, no session modified).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);

        Assert.Equal(HttpStatusCode.Unauthorized, (await PostRefresh(client, "never-issued-" + Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new { })).StatusCode);
        await WithDb(async db => Assert.Null((await db.AuthenticationSessions.AsNoTracking().SingleAsync(x => x.Id == session.SessionId)).RevokedAt));
        Assert.Equal(HttpStatusCode.OK, (await PostRefresh(client, session.RefreshToken)).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-REFRESH-005")]
    public async Task IT_AUTH_REFRESH_005_RefreshCannotExtendTheSevenDayAbsoluteDeadline()
    {
        // Basis: plan (7-day absolute session; refresh after it -> 401 and session revoked).
        var clock = new PlanClock(DateTimeOffset.UtcNow);
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<TimeProvider>(clock)));
        using var client = host.CreateClient();
        var user = await CreateUser(Roles.Owner);
        var session = await Login(client, user);
        Assert.InRange(session.SessionExpiresAt - clock.UtcNow, TimeSpan.FromDays(7) - TimeSpan.FromMinutes(1), TimeSpan.FromDays(7));

        clock.UtcNow = session.SessionExpiresAt.AddSeconds(1);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostRefresh(client, session.RefreshToken)).StatusCode);
        // "Session revoked" in the plan = the session can no longer be used: revoked, or its absolute deadline passed
        // without being extended by the refresh attempt.
        await WithDb(async db =>
        {
            var stored = await db.AuthenticationSessions.AsNoTracking().SingleAsync(x => x.Id == session.SessionId);
            Assert.True(stored.RevokedAt != null || stored.ExpiresAt <= clock.UtcNow, "The session is still usable after 7 days.");
            Assert.InRange(stored.ExpiresAt, session.SessionExpiresAt.AddSeconds(-1), session.SessionExpiresAt.AddSeconds(1));
        });
    }

    // ───────────── User Sign-Out (UC-02, SRS §2.1.1 "Sign Out securely terminates the current session") ─────────────

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGOUT-001")]
    public async Task IT_AUTH_LOGOUT_001_SignOutEndsTheCurrentSession()
    {
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        Bearer(client, session);

        Assert.True((await client.PostAsync("/api/v1/auth/logout", null)).IsSuccessStatusCode);
        await WithDb(async db => Assert.NotNull((await db.AuthenticationSessions.AsNoTracking().SingleAsync(x => x.Id == session.SessionId)).RevokedAt));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGOUT-002")]
    public async Task IT_AUTH_LOGOUT_002_SignOutOnOneDeviceKeepsOtherDevicesSignedIn()
    {
        // Basis: UC-02 ("current session"); plan: device B stays active.
        var user = await CreateUser(Roles.Owner);
        using var deviceA = fixture.Factory.CreateClient();
        using var deviceB = fixture.Factory.CreateClient();
        Bearer(deviceA, await Login(deviceA, user));
        Bearer(deviceB, await Login(deviceB, user));

        Assert.True((await deviceA.PostAsync("/api/v1/auth/logout", null)).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await deviceA.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await deviceB.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-LOGOUT-003")]
    public async Task IT_AUTH_LOGOUT_003_SignOutOfAllDevicesEndsEverySession()
    {
        // Basis: plan (all sessions revoked, both devices 401). The API exposes it as /auth/logout-all.
        var user = await CreateUser(Roles.Owner);
        using var deviceA = fixture.Factory.CreateClient();
        using var deviceB = fixture.Factory.CreateClient();
        var a = await Login(deviceA, user);
        var b = await Login(deviceB, user);
        Bearer(deviceA, a);
        Bearer(deviceB, b);

        Assert.True((await deviceB.PostAsync("/api/v1/auth/logout-all", null)).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await deviceA.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await deviceB.GetAsync("/api/v1/auth/me")).StatusCode);
        await WithDb(async db => Assert.False(await db.AuthenticationSessions.AnyAsync(x => x.UserId == user.Id && x.RevokedAt == null)));
    }

    // ───────────── Credential Management: change-password / forgot-password / reset-password (NFR §2.3) ─────────────

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PWD-001")]
    public async Task IT_AUTH_PWD_001_ChangePasswordRevokesOldSessionsAndSwapsThePassword()
    {
        // Basis: NFR §2.3 Password Protection (hash only); plan: old sessions revoked, old password 401, new 200.
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        var hashBefore = await PasswordHash(user.Id);
        Bearer(client, session);

        var response = await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = Password, newPassword = NewPassword });
        Assert.True(response.IsSuccessStatusCode, $"change-password returned {(int)response.StatusCode}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        var hashAfter = await PasswordHash(user.Id);
        Assert.NotEqual(hashBefore, hashAfter);
        Assert.DoesNotContain(NewPassword, hashAfter!, StringComparison.Ordinal);

        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostLogin(client, user.Email!, Password)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostLogin(client, user.Email!, NewPassword)).StatusCode);
    }

    [Theory]
    [Trait("TestCaseId", "IT-AUTH-PWD-002")]
    [InlineData("Wrong!Current-000", NewPassword)]
    [InlineData(Password, "aaaaaaaaaaaa")]
    public async Task IT_AUTH_PWD_002_WrongCurrentOrWeakNewPasswordIsRejected(string current, string next)
    {
        // Basis: plan (HTTP 400, password unchanged in DB).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, user);
        var hashBefore = await PasswordHash(user.Id);
        Bearer(client, session);

        var response = await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = current, newPassword = next });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(hashBefore, await PasswordHash(user.Id));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PWD-003")]
    public async Task IT_AUTH_PWD_003_ForgotPasswordByEmailDoesNotRevealAccountExistence()
    {
        // Basis: SRS §2.1.1 (account identifier is the email), plan + GBR-13 note: same answer for both, mail sent
        // only for the real account.
        var delivery = new PlanResetDelivery();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await CreateUser(Roles.Owner);

        var existing = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = user.Email });
        var unknown = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = $"ghost-{Guid.NewGuid():N}@example.invalid" });

        Assert.True(existing.IsSuccessStatusCode, $"forgot-password with an email returned {(int)existing.StatusCode}");
        Assert.Equal(existing.StatusCode, unknown.StatusCode);
        Assert.Equal(await existing.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.Single(delivery.Tokens);
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PWD-004")]
    public async Task IT_AUTH_PWD_004_ResetTokenIsOneTimeAndExpires()
    {
        // Basis: plan (valid token -> success; replay and expired token -> HTTP 400).
        var delivery = new PlanResetDelivery();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await CreateUser(Roles.Owner);

        Assert.True((await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.UserName })).IsSuccessStatusCode);
        var token = Assert.Single(delivery.Tokens);
        var reset = new { userName = user.UserName, token, newPassword = NewPassword };
        Assert.True((await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);

        Assert.True((await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.UserName })).IsSuccessStatusCode);
        var expiredAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await WithDb(db => db.PasswordResetGrants.Where(x => x.UserId == user.Id && x.ConsumedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.ExpiresAt, expiredAt)));
        var expired = new { userName = user.UserName, token = delivery.Tokens.Last(), newPassword = Password };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", expired)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostLogin(client, user.Email!, NewPassword)).StatusCode);
    }

    // ───────────── Personal Profile: GET & PUT /api/v1/profile (UC-03, SRS §2.2.1) ─────────────

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PROF-001")]
    public async Task IT_AUTH_PROF_001_UserViewsAndUpdatesPermittedProfileFields()
    {
        // Basis: UC-03, SRS §2.2.1 (Full Name, Phone, Email editable; Save updates permitted fields).
        var user = await CreateUser(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        Bearer(client, await Login(client, user));

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/profile")).StatusCode);
        var phone = "09" + Random.Shared.Next(10_000_000, 99_999_999);
        var update = await client.PutAsJsonAsync("/api/v1/profile", new { fullName = "Plan Test Owner", phoneNumber = phone });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        await WithDb(async db => Assert.Equal(phone, (await db.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id)).PhoneNumber));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PROF-002")]
    public async Task IT_AUTH_PROF_002_RoleAndLocationCannotBeChangedThroughTheProfile()
    {
        // Basis: SRS §2.2.1 (Role is read-only), GBR-01/02; plan: HTTP 400, role unchanged.
        var user = await CreateUser(Roles.Staff);
        using var client = fixture.Factory.CreateClient();
        Bearer(client, await Login(client, user));

        var response = await client.PutAsJsonAsync("/api/v1/profile", new { role = Roles.Owner, assignedLocationId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        Assert.Equal([Roles.Staff], await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!));
    }

    [Fact]
    [Trait("TestCaseId", "IT-AUTH-PROF-003")]
    public async Task IT_AUTH_PROF_003_NewTenantMustCompleteProfileBeforeUsingTenancyFunctions()
    {
        // Basis: UC-03 "On first login, Tenant completes required profile information"; plan: HTTP 403.
        var user = await CreateUser(Roles.Tenant);
        using var client = fixture.Factory.CreateClient();
        Bearer(client, await Login(client, user));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/invoices")).StatusCode);
    }

    // ───────────── Helpers ─────────────

    private async Task<ApplicationUser> CreateUser(string? role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid", EmailConfirmed = true, LockoutEnabled = true };
        var created = await users.CreateAsync(user, Password);
        Assert.True(created.Succeeded, string.Join(", ", created.Errors.Select(e => e.Code)));
        if (role is not null) Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private static Task<HttpResponseMessage> PostLogin(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });

    private static Task<HttpResponseMessage> PostRefresh(HttpClient client, string? token) =>
        client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = token });

    private static async Task<LoginResult> Login(HttpClient client, ApplicationUser user)
    {
        var response = await PostLogin(client, user.Email!, Password);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResult>())!;
    }

    private static void Bearer(HttpClient client, LoginResult session) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);

    private static async Task<string?> ProblemTitle(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.TryGetProperty("title", out var title) ? title.GetString() : null;
    }

    // SRS MSG17 is the only sign-in error text the SRS defines; any other wording is reported as a defect.
    private static async Task AssertMsg17(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(body.Contains(Msg17, StringComparison.Ordinal), $"Expected SRS MSG17 \"{Msg17}\" but got: {body}");
    }

    private async Task<string?> PasswordHash(Guid id)
    {
        string? hash = null;
        await WithDb(async db => hash = (await db.Users.AsNoTracking().SingleAsync(x => x.Id == id)).PasswordHash);
        return hash;
    }

    private string ResignedToken(string accessToken, DateTime notBefore, DateTime expires)
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<JwtOptions>>().Value;
        var original = new JwtSecurityTokenHandler().ReadJwtToken(accessToken);
        var claims = original.Claims.Where(x => x.Type is "sub" or "role" or "sid" or "sstamp" or "jti");
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(settings.Issuer, settings.Audience, claims, notBefore, expires,
            new Microsoft.IdentityModel.Tokens.SigningCredentials(
                new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256)));
    }

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '='));
    }

    private static string Base64UrlEncode(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private async Task WithDb(Func<BHomeDbContext, Task> action)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        await action(scope.ServiceProvider.GetRequiredService<BHomeDbContext>());
    }

    private sealed class PlanClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    // Test-only delivery so a reset token can be read; never registered by the shipped application.
    private sealed class PlanResetDelivery : IPasswordResetDelivery
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
