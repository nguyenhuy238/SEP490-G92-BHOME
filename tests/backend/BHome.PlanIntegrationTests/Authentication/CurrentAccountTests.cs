using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "Current Account Identity: GET /api/v1/auth/me".
/// Expected results are copied from the plan; nothing here is derived from backend code.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class CurrentAccountTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-ME-001 Retrieve current authenticated user profile")]
    [Trait("TestCase", "IT-AUTH-ME-001")]
    public async Task IT_AUTH_ME_001()
    {
        var owner = PlanSettings.Current.Account("owner");

        // 1. Sign in as Owner to obtain accessToken.
        var token = await sessions.TokenAsync("owner");

        // 2. GET /api/v1/auth/me with Bearer token.
        var response = await _api.GetAsync(AuthKit.Me, token);

        // HTTP 200; returns userId, email, roles=["Owner"], sessionId.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        var json = await response.JsonAsync();
        Assert.False(string.IsNullOrEmpty(json.Str("userId")), "userId is missing.");
        Assert.Equal(owner.Email, json.Str("email"), StringComparer.OrdinalIgnoreCase);
        Assert.Equal(new[] { "Owner" }, AuthKit.Roles(json));
        Assert.False(string.IsNullOrEmpty(json.Str("sessionId")), "sessionId is missing.");

        // Zero password hash or secret data disclosed.
        PlanAssert.DoesNotLeak(body, "passwordHash", "securityStamp", "refreshToken", owner.Password);
    }

    [SkippableFact(DisplayName = "IT-AUTH-ME-002 Reject unauthenticated request to /me endpoint")]
    [Trait("TestCase", "IT-AUTH-ME-002")]
    public async Task IT_AUTH_ME_002()
    {
        // 1. GET /api/v1/auth/me without Authorization header.
        var response = await _api.GetAsync(AuthKit.Me);

        // HTTP 401; message: Yêu cầu xác thực tài khoản. No profile data returned.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized);
        PlanAssert.HasMessage(body, "Yêu cầu xác thực tài khoản.");
        PlanAssert.DoesNotLeak(body, "userId", "sessionId", "roles");
    }

    [Fact(DisplayName = "IT-AUTH-ME-003 Reject request with expired JWT token", Skip = PlanSkip.ServerClock + " An access token with exp < now cannot be forged (the signature would fail first, giving the signature message) and the 30-minute JWT lifetime cannot be waited out in a test run.")]
    [Trait("TestCase", "IT-AUTH-ME-003")]
    public void IT_AUTH_ME_003()
    {
        // GET /api/v1/auth/me with expired accessToken → HTTP 401; message: Phiên đăng nhập đã hết hạn.
    }

    [SkippableFact(DisplayName = "IT-AUTH-ME-004 Reject request with tampered JWT signature")]
    [Trait("TestCase", "IT-AUTH-ME-004")]
    public async Task IT_AUTH_ME_004()
    {
        // 1. Tamper role claim in JWT from Tenant to Owner.
        var token = await sessions.TokenAsync("tenant");
        var tampered = AuthKit.TamperPayload(token, "\"Tenant\"", "\"Owner\"");

        // 2. GET /api/v1/auth/me with tampered token.
        var response = await _api.GetAsync(AuthKit.Me, tampered);

        // HTTP 401; message: Chữ ký token không hợp lệ.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized);
        PlanAssert.HasMessage(body, "Chữ ký token không hợp lệ.");
    }

    [SkippableFact(DisplayName = "IT-AUTH-ME-005 Invalidate token when SecurityStamp is rotated in PostgreSQL")]
    [Trait("TestCase", "IT-AUTH-ME-005")]
    public async Task IT_AUTH_ME_005()
    {
        var staff = PlanSettings.Current.Account("staff");
        Skip.If(!AuthKit.DbOn, "This test case changes the database. Set BHOME_IT_DB to the Npgsql connection string of the API database.");

        // 1. Sign in as Staff to get token.
        var session = await sessions.NewSessionAsync("staff");

        // 2. In PostgreSQL: UPDATE AspNetUsers SET SecurityStamp = gen_random_uuid().
        await AuthKit.UpdateUserAsync("\"SecurityStamp\" = gen_random_uuid()::text", staff.Email);
        sessions.Forget("staff");

        // 3. GET /api/v1/auth/me with existing token.
        var response = await _api.GetAsync(AuthKit.Me, session.AccessToken);

        // HTTP 401; message: Phiên đăng nhập không còn hiệu lực.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized);
        PlanAssert.HasMessage(body, "Phiên đăng nhập không còn hiệu lực.");
    }
}
