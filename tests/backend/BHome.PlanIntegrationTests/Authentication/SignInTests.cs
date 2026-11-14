using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "User Sign-In: POST /api/v1/auth/login".
/// Expected results are copied from the plan; nothing here is derived from backend code.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class SignInTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-001 Authenticate Property Owner successfully")]
    [Trait("TestCase", "IT-AUTH-LOGIN-001")]
    public async Task IT_AUTH_LOGIN_001()
    {
        var owner = PlanSettings.Current.Account("owner");

        // 1. POST valid Owner credentials.
        var response = await _api.PostAsync("api/v1/auth/login", new { email = owner.Email, password = owner.Password });

        // HTTP 200; message: Đăng nhập thành công.; response contains accessToken, refreshToken, roles=["Owner"].
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        PlanAssert.HasMessage(body, "Đăng nhập thành công.");
        var json = await response.JsonAsync();
        Assert.False(string.IsNullOrEmpty(json.Str("accessToken")), "accessToken is missing.");
        Assert.False(string.IsNullOrEmpty(json.Str("refreshToken")), "refreshToken is missing.");
        var roles = json.Find("roles")?.EnumerateArray().Select(r => r.GetString() ?? string.Empty).ToArray() ?? [];
        Assert.Equal(new[] { "Owner" }, roles);

        // 2. Query AspNetUserSessions: the session record is persisted in DB.
        var sessionId = json.Str("sessionId");
        Assert.False(string.IsNullOrEmpty(sessionId), "sessionId is missing.");
        Assert.Equal(1L, await PlanDb.CountRowsMentioningAsync("AspNetUserSessions", sessionId!));
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-005 Reject sign-in with non-existent email")]
    [Trait("TestCase", "IT-AUTH-LOGIN-005")]
    public async Task IT_AUTH_LOGIN_005()
    {
        var owner = PlanSettings.Current.Account("owner");

        // 1. POST with unregistered email ghost@bhome.vn.
        var ghost = await _api.PostAsync("api/v1/auth/login", new { email = "ghost@bhome.vn", password = owner.Password + "x" });
        // 2. Compare response with wrong-password response.
        var wrong = await _api.PostAsync("api/v1/auth/login", new { email = owner.Email, password = owner.Password + "x" });

        // HTTP 401; message: Đăng nhập thất bại. Identical message as wrong password (GBR-13).
        var ghostBody = await PlanAssert.StatusAsync(ghost, HttpStatusCode.Unauthorized, "unregistered email");
        var wrongBody = await PlanAssert.StatusAsync(wrong, HttpStatusCode.Unauthorized, "wrong password");
        PlanAssert.HasMessage(ghostBody, "Đăng nhập thất bại.", "unregistered email");
        Assert.Equal((await wrong.JsonAsync()).Str("title"), (await ghost.JsonAsync()).Str("title"));
        Assert.Equal((await wrong.JsonAsync()).Str("detail"), (await ghost.JsonAsync()).Str("detail"));
        _ = wrongBody;
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-002 Authenticate Staff account with single role restriction")]
    [Trait("TestCase", "IT-AUTH-LOGIN-002")]
    public async Task IT_AUTH_LOGIN_002()
    {
        var staff = PlanSettings.Current.Account("staff");

        // 1. POST valid Staff credentials.
        var login = await AuthKit.LoginAsync(_api, staff.Email, staff.Password);

        // HTTP 200; role is Staff only.
        await PlanAssert.StatusAsync(login, HttpStatusCode.OK, "login");
        var json = await login.JsonAsync();
        Assert.Equal(new[] { "Staff" }, AuthKit.Roles(json));

        // 3. GET /api/v1/auth/me.
        var me = await _api.GetAsync(AuthKit.Me, json.Str("accessToken"));

        // HTTP 200; role is Staff only; account shows assigned locationId="LOC-TB-01" (BHOME Tân Bình).
        var meBody = await PlanAssert.StatusAsync(me, HttpStatusCode.OK, "me");
        var meJson = await me.JsonAsync();
        Assert.Equal(new[] { "Staff" }, AuthKit.Roles(meJson));
        Assert.True(meJson.AllStrings().Contains("LOC-TB-01"), $"Expected assigned locationId \"LOC-TB-01\" in /me. Body: {meBody}");

        // 2. Query AspNetUserRoles: exactly one role row for the user (Staff only).
        var userId = json.Str("userId");
        Assert.False(string.IsNullOrEmpty(userId), "userId is missing.");
        Assert.Equal(1L, await PlanDb.CountRowsMentioningAsync("AspNetUserRoles", userId!));
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-003 Authenticate Tenant account with tenancy isolation")]
    [Trait("TestCase", "IT-AUTH-LOGIN-003")]
    public async Task IT_AUTH_LOGIN_003()
    {
        var tenant = PlanSettings.Current.Account("tenant");

        // 1. POST valid Tenant credentials.
        var login = await AuthKit.LoginAsync(_api, tenant.Email, tenant.Password);

        // HTTP 200; role is Tenant only.
        await PlanAssert.StatusAsync(login, HttpStatusCode.OK, "login");
        var json = await login.JsonAsync();
        Assert.Equal(new[] { "Tenant" }, AuthKit.Roles(json));

        // 3. GET /api/v1/auth/me.
        var me = await _api.GetAsync(AuthKit.Me, json.Str("accessToken"));

        // HTTP 200; role is Tenant only; account is scoped strictly to personal room tenancy (Phòng P.201).
        var meBody = await PlanAssert.StatusAsync(me, HttpStatusCode.OK, "me");
        var meJson = await me.JsonAsync();
        Assert.Equal(new[] { "Tenant" }, AuthKit.Roles(meJson));
        Assert.True(meBody.Contains("P.201", StringComparison.Ordinal), $"Expected the tenancy room P.201 in /me. Body: {meBody}");

        // 2. Query Contracts in DB.
        await PlanDb.RequirePlanTableAsync("Contracts");
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-004 Reject sign-in with wrong password")]
    [Trait("TestCase", "IT-AUTH-LOGIN-004")]
    public async Task IT_AUTH_LOGIN_004()
    {
        var owner = PlanSettings.Current.Account("owner");
        var before = AuthKit.DbOn ? AuthKit.Int(await AuthKit.UserColumnAsync("AccessFailedCount", owner.Email)) : 0;

        // 1. POST valid Owner email with incorrect password.
        var response = await AuthKit.LoginAsync(_api, owner.Email, owner.Password + "x");

        // HTTP 401; message: Đăng nhập thất bại. No token is issued.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized);
        PlanAssert.HasMessage(body, "Đăng nhập thất bại.");
        Assert.DoesNotContain("accessToken", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("refreshToken", body, StringComparison.OrdinalIgnoreCase);

        try
        {
            // 2. Query AspNetUsers: AccessFailedCount incremented by 1.
            var after = AuthKit.Int(await AuthKit.UserColumnAsync("AccessFailedCount", owner.Email));
            Assert.Equal(before + 1, after);
        }
        finally
        {
            // Not a plan step: a successful sign-in resets the counter so repeated runs never lock the shared Owner account.
            (await AuthKit.LoginAsync(_api, owner.Email, owner.Password)).Dispose();
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-006 Reject deactivated, locked, or unapproved accounts")]
    [Trait("TestCase", "IT-AUTH-LOGIN-006")]
    public async Task IT_AUTH_LOGIN_006()
    {
        var inactive = PlanSettings.Current.Account("inactive");
        var locked = PlanSettings.Current.Account("locked");
        var noRoles = PlanSettings.Current.Account("noroles");

        // 1. Seed accounts with IsActive=false, LockoutEnd>NOW(), and empty roles in PostgreSQL.
        //    ("noroles" must be provisioned without any AspNetUserRoles row.)
        await AuthKit.UpdateUserAsync("\"IsActive\" = false", inactive.Email);
        await AuthKit.UpdateUserAsync("\"LockoutEnd\" = NOW() + interval '1 hour'", locked.Email);
        try
        {
            var sessionsBefore = await AuthKit.CountAsync("AspNetUserSessions");

            // 2. POST /api/v1/auth/login for each account.
            foreach (var account in new[] { inactive, locked, noRoles })
            {
                var response = await AuthKit.LoginAsync(_api, account.Email, account.Password);

                // HTTP 401; message: Đăng nhập thất bại. No token is created.
                var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized, account.Name);
                PlanAssert.HasMessage(body, "Đăng nhập thất bại.", account.Name);
                Assert.DoesNotContain("accessToken", body, StringComparison.OrdinalIgnoreCase);
            }

            // No session is created in DB.
            Assert.Equal(sessionsBefore, await AuthKit.CountAsync("AspNetUserSessions"));
        }
        finally
        {
            await AuthKit.UpdateUserAsync("\"IsActive\" = true", inactive.Email);
            await AuthKit.UpdateUserAsync("\"LockoutEnd\" = NULL", locked.Email);
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-007 Reject missing or malformed email and password")]
    [Trait("TestCase", "IT-AUTH-LOGIN-007")]
    public async Task IT_AUTH_LOGIN_007()
    {
        var owner = PlanSettings.Current.Account("owner");
        var cases = new (string Step, object Payload)[]
        {
            // 1. POST with missing email, empty string, or "abc".
            ("missing email", new { password = owner.Password }),
            ("empty email", new { email = string.Empty, password = owner.Password }),
            ("email abc", new { email = "abc", password = owner.Password }),
            // 2. POST with missing password.
            ("missing password", new { email = owner.Email }),
        };

        foreach (var (step, payload) in cases)
        {
            var response = await _api.PostAsync(AuthKit.Login, payload);

            // HTTP 400; message: Vui lòng nhập email và mật khẩu. (rejected by model validation)
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.BadRequest, step);
            PlanAssert.HasMessage(body, "Vui lòng nhập email và mật khẩu.", step);
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-008 Enforce account lockout after 5 consecutive failed attempts")]
    [Trait("TestCase", "IT-AUTH-LOGIN-008")]
    public async Task IT_AUTH_LOGIN_008()
    {
        var account = PlanSettings.Current.Account("lockout");

        // Pre-condition: fresh account with 0 failed attempts.
        await AuthKit.UpdateUserAsync("\"AccessFailedCount\" = 0, \"LockoutEnd\" = NULL", account.Email);
        try
        {
            // 1. POST with wrong password 5 times in a row.
            for (var i = 1; i <= 5; i++)
            {
                var wrong = await AuthKit.LoginAsync(_api, account.Email, account.Password + "x");
                await PlanAssert.StatusAsync(wrong, HttpStatusCode.Unauthorized, $"wrong password #{i}");
            }

            // 2. Query AspNetUsers.LockoutEnd: LockoutEnd set to NOW() + 15 minutes in DB.
            var seconds = await PlanDb.ScalarAsync(
                "SELECT EXTRACT(EPOCH FROM (\"LockoutEnd\" - NOW())) FROM \"AspNetUsers\" WHERE \"NormalizedEmail\" = upper(@e)",
                ("e", account.Email));
            Assert.NotNull(seconds);
            var remaining = AuthKit.Double(seconds);
            Assert.InRange(remaining, 13 * 60, (15 * 60) + 30);

            // 3. POST with correct password.
            var correct = await AuthKit.LoginAsync(_api, account.Email, account.Password);

            // HTTP 401; message: Đăng nhập thất bại. Tài khoản bị tạm khóa 15 phút.
            var body = await PlanAssert.StatusAsync(correct, HttpStatusCode.Unauthorized, "correct password while locked");
            PlanAssert.HasMessage(body, "Đăng nhập thất bại. Tài khoản bị tạm khóa 15 phút.");
        }
        finally
        {
            await AuthKit.UpdateUserAsync("\"AccessFailedCount\" = 0, \"LockoutEnd\" = NULL", account.Email);
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-009 Enforce sign-in rate limiting (30 requests/minute)")]
    [Trait("TestCase", "IT-AUTH-LOGIN-009")]
    public async Task IT_AUTH_LOGIN_009()
    {
        // An unregistered email is used so the burst never locks a real account.
        var payload = new { email = "ratelimit.ghost@bhome.vn", password = "Wrong@Password2026" };
        try
        {
            // 1. Send > 30 login requests within 60s from same IP.
            HttpResponseMessage? limited = null;
            for (var i = 1; i <= 31 && limited is null; i++)
            {
                var response = await _api.SendAsync(HttpMethod.Post, AuthKit.Login, payload, waitWhenRateLimited: false);
                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    limited = response;
                }
            }

            // HTTP 429; message: Quá nhiều yêu cầu. Vui lòng thử lại sau.
            Assert.True(limited is not null, "Expected HTTP 429 after more than 30 login requests within 60 s.");
            var body = await PlanAssert.StatusAsync(limited!, HttpStatusCode.TooManyRequests);
            PlanAssert.HasMessage(body, "Quá nhiều yêu cầu. Vui lòng thử lại sau.");

            // 2. Send request with spoofed X-Forwarded-For header.
            var spoofed = await _api.SendAsync(
                HttpMethod.Post,
                AuthKit.Login,
                payload,
                headers: new Dictionary<string, string> { ["X-Forwarded-For"] = $"203.0.113.{Random.Shared.Next(1, 254)}" },
                waitWhenRateLimited: false);

            // Spoofed header rejected; rate limiter binds to socket IP (still HTTP 429).
            var spoofedBody = await PlanAssert.StatusAsync(spoofed, HttpStatusCode.TooManyRequests, "spoofed X-Forwarded-For");
            PlanAssert.HasMessage(spoofedBody, "Quá nhiều yêu cầu. Vui lòng thử lại sau.", "spoofed X-Forwarded-For");
        }
        finally
        {
            // Let the 60 s window pass so the following tests are not rate limited.
            await Task.Delay(TimeSpan.FromSeconds(61));
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-010 Email is case-insensitive; username rejected in email field")]
    [Trait("TestCase", "IT-AUTH-LOGIN-010")]
    public async Task IT_AUTH_LOGIN_010()
    {
        var owner = PlanSettings.Current.Account("owner");

        // 1. POST with email in uppercase.
        var upper = await AuthKit.LoginAsync(_api, owner.Email.ToUpperInvariant(), owner.Password);

        // Step 1: HTTP 200.
        await PlanAssert.StatusAsync(upper, HttpStatusCode.OK, "uppercase email");

        // 2. POST with username "chutro_dev" in email field.
        var userName = await AuthKit.LoginAsync(_api, "chutro_dev", owner.Password);

        // Step 2: HTTP 400; message: Email không đúng định dạng.
        var body = await PlanAssert.StatusAsync(userName, HttpStatusCode.BadRequest, "username in email field");
        PlanAssert.HasMessage(body, "Email không đúng định dạng.", "username in email field");

        // Step 1: NormalizedEmail lookup matches in DB.
        await PlanDb.RequirePlanTableAsync("AspNetUsers");
        var matches = await PlanDb.ScalarAsync(
            "SELECT COUNT(*) FROM \"AspNetUsers\" WHERE \"NormalizedEmail\" = @n",
            ("n", owner.Email.ToUpperInvariant()));
        Assert.Equal(1L, AuthKit.Long(matches));
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-011 Reject legacy login payload without email")]
    [Trait("TestCase", "IT-AUTH-LOGIN-011")]
    public async Task IT_AUTH_LOGIN_011()
    {
        var owner = PlanSettings.Current.Account("owner");
        var sessionsBefore = AuthKit.DbOn ? await AuthKit.CountAsync("AspNetUserSessions") : 0;

        // 1. POST with { userName, password } without email property.
        var response = await _api.PostAsync(AuthKit.Login, new { userName = owner.Email, password = owner.Password });

        // HTTP 400; message: Trường Email là bắt buộc.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.BadRequest);
        PlanAssert.HasMessage(body, "Trường Email là bắt buộc.");

        // No session is created.
        Assert.Equal(sessionsBefore, await AuthKit.CountAsync("AspNetUserSessions"));
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-012 Handle duplicate legacy normalized email safely")]
    [Trait("TestCase", "IT-AUTH-LOGIN-012")]
    public async Task IT_AUTH_LOGIN_012()
    {
        // 1. Two legacy accounts having the same normalized email (pre-condition: "legacydup" is that email).
        var account = PlanSettings.Current.Account("legacydup");
        await PlanDb.RequirePlanTableAsync("AspNetUsers");
        var duplicates = AuthKit.Long(await PlanDb.ScalarAsync(
            "SELECT COUNT(*) FROM \"AspNetUsers\" WHERE \"NormalizedEmail\" = upper(@e)", ("e", account.Email)));
        Skip.If(duplicates < 2, $"Pre-condition missing: AspNetUsers must hold 2+ rows with NormalizedEmail = upper('{account.Email}').");
        var sessionsBefore = await AuthKit.CountAsync("AspNetUserSessions");

        // 2. POST /api/v1/auth/login with that email.
        var response = await AuthKit.LoginAsync(_api, account.Email, account.Password);

        // HTTP 401; message: Đăng nhập thất bại. No session is created (the collision log is not visible black-box).
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized);
        PlanAssert.HasMessage(body, "Đăng nhập thất bại.");
        Assert.Equal(sessionsBefore, await AuthKit.CountAsync("AspNetUserSessions"));
    }

    [SkippableFact(DisplayName = "IT-AUTH-LOGIN-013 Sign in with registered phone number per SRS FE-02 §2.1.1")]
    [Trait("TestCase", "IT-AUTH-LOGIN-013")]
    public async Task IT_AUTH_LOGIN_013()
    {
        var tenant = PlanSettings.Current.Account("tenant");
        Skip.If(string.IsNullOrWhiteSpace(tenant.Phone), "Set BHOME_IT_ACCOUNT_TENANT_PHONE (plan: 0912345678).");

        // 1. POST with registered phoneNumber and valid password.
        var response = await _api.PostAsync(AuthKit.Login, new { phoneNumber = tenant.Phone, password = tenant.Password });

        // HTTP 200; message: Đăng nhập thành công.; returns valid token pair.
        var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        PlanAssert.HasMessage(body, "Đăng nhập thành công.");
        var json = await response.JsonAsync();
        Assert.False(string.IsNullOrEmpty(json.Str("accessToken")), "accessToken is missing.");
        Assert.False(string.IsNullOrEmpty(json.Str("refreshToken")), "refreshToken is missing.");

        // Session persisted in AspNetUserSessions.
        var sessionId = json.Str("sessionId");
        Assert.False(string.IsNullOrEmpty(sessionId), "sessionId is missing.");
        Assert.Equal(1L, await PlanDb.CountRowsMentioningAsync("AspNetUserSessions", sessionId!));
    }
}
