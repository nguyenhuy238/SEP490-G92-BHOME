using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "Personal Profile: GET &amp; PUT /api/v1/profile" (route as written in the plan;
/// docs/api documents no such route).
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class ProfileTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-PROF-001 Retrieve and update personal profile")]
    [Trait("TestCase", "IT-AUTH-PROF-001")]
    public async Task IT_AUTH_PROF_001()
    {
        var owner = PlanSettings.Current.Account("owner");
        var token = await sessions.TokenAsync("owner");

        // 1. GET /api/v1/profile.
        var get = await _api.GetAsync(AuthKit.Profile, token);
        await PlanAssert.StatusAsync(get, HttpStatusCode.OK, "GET profile");
        var original = await get.JsonAsync();
        var newName = PlanData.Unique("Nguyễn Huy");
        var newPhone = "09" + Random.Shared.Next(10000000, 99999999);
        try
        {
            // 2. PUT /api/v1/profile with updated phone and name.
            var put = await _api.PutAsync(AuthKit.Profile, new { fullName = newName, phoneNumber = newPhone }, token);

            // HTTP 200; message: Cập nhật thông tin thành công.
            var body = await PlanAssert.StatusAsync(put, HttpStatusCode.OK, "PUT profile");
            PlanAssert.HasMessage(body, "Cập nhật thông tin thành công.");

            // 3. Query AspNetUsers: FullName and PhoneNumber updated in DB.
            Assert.Equal(newName, (await AuthKit.UserColumnAsync("FullName", owner.Email))?.ToString());
            Assert.Equal(newPhone, (await AuthKit.UserColumnAsync("PhoneNumber", owner.Email))?.ToString());
        }
        finally
        {
            // Restore the Owner profile (not a plan step).
            (await _api.PutAsync(AuthKit.Profile, new { fullName = original.Str("fullName"), phoneNumber = original.Str("phoneNumber") }, token)).Dispose();
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-PROF-002 Read-only system fields (role, location) cannot be tampered")]
    [Trait("TestCase", "IT-AUTH-PROF-002")]
    public async Task IT_AUTH_PROF_002()
    {
        var session = await sessions.SessionAsync("staff");
        var rolesBefore = AuthKit.DbOn ? await PlanDb.CountRowsMentioningAsync("AspNetUserRoles", session.UserId ?? "") : 0;

        var cases = new (string Step, object Payload)[]
        {
            // 1. PUT /api/v1/profile attempting to change role to "Owner" ...
            ("change role", new { role = "Owner" }),
            // ... or change assignedLocationId.
            ("change assignedLocationId", new { assignedLocationId = Guid.NewGuid() }),
        };

        foreach (var (step, payload) in cases)
        {
            var response = await _api.PutAsync(AuthKit.Profile, payload, session.AccessToken);

            // HTTP 400; message: Không thể chỉnh sửa quyền hoặc cơ sở phân công.
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.BadRequest, step);
            PlanAssert.HasMessage(body, "Không thể chỉnh sửa quyền hoặc cơ sở phân công.", step);
        }

        // Role and location remain unchanged per GBR-01..03: still Staff only, same role rows in DB.
        var me = await _api.GetAsync(AuthKit.Me, session.AccessToken);
        await PlanAssert.StatusAsync(me, HttpStatusCode.OK, "me");
        Assert.Equal(new[] { "Staff" }, AuthKit.Roles(await me.JsonAsync()));
        Assert.Equal(rolesBefore, await PlanDb.CountRowsMentioningAsync("AspNetUserRoles", session.UserId ?? ""));
    }

    [SkippableFact(DisplayName = "IT-AUTH-PROF-003 New tenant forced profile completion on first login")]
    [Trait("TestCase", "IT-AUTH-PROF-003")]
    public async Task IT_AUTH_PROF_003()
    {
        // 1. Sign in as new Tenant (IsProfileCompleted=false).
        var token = await sessions.TokenAsync("newtenant");

        // 2. Try accessing tenancy invoice before profile completion.
        var response = await _api.GetAsync("api/v1/invoices", token);

        // HTTP 403; message: Vui lòng hoàn tất thông tin cá nhân trước khi sử dụng hệ thống.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden);
        PlanAssert.HasMessage(body, "Vui lòng hoàn tất thông tin cá nhân trước khi sử dụng hệ thống.");
    }
}
