using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "Refresh Token Rotation: POST /api/v1/auth/refresh".
/// Request body { refreshToken } (mobile JSON transport) from docs/api/API_CONVENTIONS.md.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class RefreshTokenTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-REFRESH-001 Rotate refresh token and issue new access token")]
    [Trait("TestCase", "IT-AUTH-REFRESH-001")]
    public async Task IT_AUTH_REFRESH_001()
    {
        // Pre-condition: active session with valid RT-01.
        var session = await sessions.NewSessionAsync("owner");
        var rt01 = RequireRefreshToken(session);

        // 1. POST /api/v1/auth/refresh with valid RT-01.
        var response = await _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt01 });

        // HTTP 200; returns new accessToken and rotated RT-02.
        await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        var json = await response.JsonAsync();
        var access = json.Str("accessToken");
        var rt02 = json.Str("refreshToken");
        Assert.False(string.IsNullOrEmpty(access), "accessToken is missing.");
        Assert.NotEqual(session.AccessToken, access);
        Assert.False(string.IsNullOrEmpty(rt02), "refreshToken (RT-02) is missing.");
        Assert.NotEqual(rt01, rt02);

        // 3. Test new accessToken with GET /api/v1/auth/me.
        await PlanAssert.StatusAsync(await _api.GetAsync(AuthKit.Me, access), HttpStatusCode.OK, "me with new accessToken");

        // 2. Query AspNetUserSessions: the session (token family) is recorded. RT-01 consumed/replaced: only hashes are stored
        //    and the plan names no column, so consumption is proven behaviourally by IT-AUTH-REFRESH-002.
        Assert.True(await PlanDb.CountRowsMentioningAsync("AspNetUserSessions", session.SessionId ?? json.Str("sessionId") ?? "") >= 1, "Session row not found.");
    }

    [SkippableFact(DisplayName = "IT-AUTH-REFRESH-002 Detect Refresh Token Reuse Attack and revoke session")]
    [Trait("TestCase", "IT-AUTH-REFRESH-002")]
    public async Task IT_AUTH_REFRESH_002()
    {
        var session = await sessions.NewSessionAsync("owner");
        var rt01 = RequireRefreshToken(session);

        // 1. Refresh RT-01 to get RT-02.
        var first = await _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt01 });
        await PlanAssert.StatusAsync(first, HttpStatusCode.OK, "refresh RT-01");
        var rt02 = (await first.JsonAsync()).Str("refreshToken");
        Assert.False(string.IsNullOrEmpty(rt02), "refreshToken (RT-02) is missing.");

        // 2. Re-send POST /api/v1/auth/refresh with consumed RT-01 (Replay Attack).
        var replay = await _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt01 });

        // Step 2: HTTP 401; message: Phát hiện tấn công tái sử dụng token.
        var replayBody = await PlanAssert.StatusAsync(replay, HttpStatusCode.Unauthorized, "replay RT-01");
        PlanAssert.HasMessage(replayBody, "Phát hiện tấn công tái sử dụng token.", "replay RT-01");

        // 3. Try using RT-02.
        var second = await _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt02 });

        // Step 3: HTTP 401; whole token family revoked.
        await PlanAssert.StatusAsync(second, HttpStatusCode.Unauthorized, "RT-02 after reuse");
    }

    [SkippableFact(DisplayName = "IT-AUTH-REFRESH-003 Handle concurrent refresh race conditions safely")]
    [Trait("TestCase", "IT-AUTH-REFRESH-003")]
    public async Task IT_AUTH_REFRESH_003()
    {
        var session = await sessions.NewSessionAsync("owner");
        var rt01 = RequireRefreshToken(session);

        // 1. Send two simultaneous POST /api/v1/auth/refresh with same RT-01 at same time.
        var answers = await Task.WhenAll(
            _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt01 }),
            _api.PostAsync(AuthKit.Refresh, new { refreshToken = rt01 }));

        // Exactly one request succeeds (HTTP 200); other request fails (HTTP 401).
        var codes = answers.Select(a => (int)a.StatusCode).OrderBy(c => c).ToArray();
        Assert.True(codes is [200, 401], $"Expected one 200 and one 401 but got {string.Join(", ", codes)}.");

        // DB remains consistent without duplicate tokens.
        Assert.Equal(1L, await PlanDb.CountRowsMentioningAsync("AspNetUserSessions", session.SessionId ?? ""));
    }

    [SkippableFact(DisplayName = "IT-AUTH-REFRESH-004 Reject unknown or missing refresh token")]
    [Trait("TestCase", "IT-AUTH-REFRESH-004")]
    public async Task IT_AUTH_REFRESH_004()
    {
        var before = AuthKit.DbOn ? await AuthKit.FingerprintAsync("AspNetUserSessions") : string.Empty;

        // 1. POST /api/v1/auth/refresh with non-existent token.
        var unknown = await _api.PostAsync(AuthKit.Refresh, new { refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray()) + "unknown" });
        // 2. POST with empty body.
        var empty = await _api.PostAsync(AuthKit.Refresh, new { });

        // HTTP 401; message: Phiên làm việc không tồn tại.
        foreach (var (step, response) in new[] { ("non-existent token", unknown), ("empty body", empty) })
        {
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized, step);
            PlanAssert.HasMessage(body, "Phiên làm việc không tồn tại.", step);
        }

        // No session modified in DB.
        Assert.Equal(before, await AuthKit.FingerprintAsync("AspNetUserSessions"));
    }

    [Fact(DisplayName = "IT-AUTH-REFRESH-005 Refresh cannot extend 7-day absolute session deadline", Skip = PlanSkip.ServerClock + " Needs a session older than 7 days (AbsoluteExpiresAt passed).")]
    [Trait("TestCase", "IT-AUTH-REFRESH-005")]
    public void IT_AUTH_REFRESH_005()
    {
        // POST /api/v1/auth/refresh after 7 days → HTTP 401; message: Phiên làm việc đã hết hạn tối đa (7 ngày). Vui lòng đăng nhập lại.
    }

    private static string RequireRefreshToken(LoginSession session)
    {
        Assert.False(string.IsNullOrEmpty(session.RefreshToken), "The login answer has no refreshToken (RT-01).");
        return session.RefreshToken!;
    }
}
