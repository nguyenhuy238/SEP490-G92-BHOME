using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "User Sign-Out: POST /api/v1/auth/logout" (body { allDevices } as written in the plan).
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class SignOutTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-LOGOUT-001 Sign out current session successfully")]
    [Trait("TestCase", "IT-AUTH-LOGOUT-001")]
    public async Task IT_AUTH_LOGOUT_001()
    {
        var session = await sessions.NewSessionAsync("owner");

        // 1. POST /api/v1/auth/logout with allDevices=false.
        var response = await _api.PostAsync(AuthKit.Logout, new { allDevices = false }, session.AccessToken);

        // HTTP 200; message: Đăng xuất thành công.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        PlanAssert.HasMessage(body, "Đăng xuất thành công.");

        // 3. Test GET /api/v1/auth/me with old token: old token returns 401.
        await PlanAssert.StatusAsync(await _api.GetAsync(AuthKit.Me, session.AccessToken), HttpStatusCode.Unauthorized, "me with old token");

        // 2. Query AspNetUserSessions: session revoked in DB (RevokedAt=NOW()).
        await PlanDb.RequirePlanTableAsync("AspNetUserSessions");
        var revokedRecently = await PlanDb.ScalarAsync(
            "SELECT bool_and(t.\"RevokedAt\" IS NOT NULL AND t.\"RevokedAt\" > NOW() - interval '5 minutes') FROM \"AspNetUserSessions\" t WHERE position(lower(@v) in lower(t::text)) > 0",
            ("v", session.SessionId ?? throw new InvalidOperationException("Login answer has no sessionId.")));
        Assert.True(revokedRecently is true, "Expected RevokedAt ≈ NOW() on the signed-out session.");
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGOUT-002 Sign out single device preserves other device sessions")]
    [Trait("TestCase", "IT-AUTH-LOGOUT-002")]
    public async Task IT_AUTH_LOGOUT_002()
    {
        // 1. Sign in on Device A (Postman) and Device B (Mobile).
        var deviceA = await sessions.NewSessionAsync("owner", "Postman");
        var deviceB = await sessions.NewSessionAsync("owner", "Mobile");

        // 2. Sign out Device A.
        var logout = await _api.PostAsync(AuthKit.Logout, new { allDevices = false }, deviceA.AccessToken);

        // Device A logged out (HTTP 200).
        await PlanAssert.StatusAsync(logout, HttpStatusCode.OK, "logout device A");

        // 3. GET /api/v1/auth/me on Device B.
        var me = await _api.GetAsync(AuthKit.Me, deviceB.AccessToken);

        // Device B remains active and operational (HTTP 200).
        await PlanAssert.StatusAsync(me, HttpStatusCode.OK, "me on device B");

        // Clean-up (not a plan step): end device B as well.
        (await _api.PostAsync(AuthKit.Logout, new { allDevices = false }, deviceB.AccessToken)).Dispose();
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGOUT-003 Sign out of all devices terminates all sessions")]
    [Trait("TestCase", "IT-AUTH-LOGOUT-003")]
    public async Task IT_AUTH_LOGOUT_003()
    {
        // 1. Sign in on Device A and Device B.
        var deviceA = await sessions.NewSessionAsync("owner", "Device A");
        var deviceB = await sessions.NewSessionAsync("owner", "Device B");

        // 2. POST /api/v1/auth/logout with allDevices=true from B.
        var response = await _api.PostAsync(AuthKit.Logout, new { allDevices = true }, deviceB.AccessToken);
        sessions.Forget("owner");

        // HTTP 200; message: Đã đăng xuất khỏi tất cả thiết bị.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        PlanAssert.HasMessage(body, "Đã đăng xuất khỏi tất cả thiết bị.");

        // 3. Test both devices: both devices return 401.
        await PlanAssert.StatusAsync(await _api.GetAsync(AuthKit.Me, deviceA.AccessToken), HttpStatusCode.Unauthorized, "device A");
        await PlanAssert.StatusAsync(await _api.GetAsync(AuthKit.Me, deviceB.AccessToken), HttpStatusCode.Unauthorized, "device B");

        // All sessions revoked in DB: no row of this user is left with RevokedAt empty.
        await PlanDb.RequirePlanTableAsync("AspNetUserSessions");
        var open = await PlanDb.ScalarAsync(
            "SELECT COUNT(*) FROM \"AspNetUserSessions\" t WHERE t.\"RevokedAt\" IS NULL AND position(lower(@v) in lower(t::text)) > 0",
            ("v", deviceB.UserId ?? throw new InvalidOperationException("Login answer has no userId.")));
        Assert.Equal(0L, AuthKit.Long(open));
    }
}
