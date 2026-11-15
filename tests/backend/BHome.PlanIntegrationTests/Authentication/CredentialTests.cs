using System.Net;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>
/// Sheet "Authentication", section "Credential Management: POST /api/v1/auth/change-password &amp; reset-password".
/// The plan's pre-condition is "Owner is signed in"; to never change the shared Owner password these tests use the
/// dedicated account "pwdchange" and restore its password at the end.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Authentication")]
public sealed class CredentialTests(PlanSessions sessions)
{
    private const string ChangePassword = "api/v1/auth/change-password";
    private const string ForgotPassword = "api/v1/auth/forgot-password";

    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "IT-AUTH-PWD-001 Change password with valid current password")]
    [Trait("TestCase", "IT-AUTH-PWD-001")]
    public async Task IT_AUTH_PWD_001()
    {
        var account = PlanSettings.Current.Account("pwdchange");
        var session = await sessions.NewSessionAsync("pwdchange");
        var hashBefore = AuthKit.DbOn ? await AuthKit.UserColumnAsync("PasswordHash", account.Email) : null;
        var newPassword = AuthKit.NewStrongPassword();
        var changed = false;
        try
        {
            // 1. POST /api/v1/auth/change-password with correct current and valid new password.
            var response = await _api.PostAsync(ChangePassword, new { currentPassword = account.Password, newPassword }, session.AccessToken);
            changed = response.IsSuccessStatusCode;

            // HTTP 200; message: Đổi mật khẩu thành công.
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
            PlanAssert.HasMessage(body, "Đổi mật khẩu thành công.");

            // Old sessions revoked.
            await PlanAssert.StatusAsync(await _api.GetAsync(AuthKit.Me, session.AccessToken), HttpStatusCode.Unauthorized, "old session");

            // 2. Test old password, then new password: old password returns 401, new password returns 200.
            await PlanAssert.StatusAsync(await AuthKit.LoginAsync(_api, account.Email, account.Password), HttpStatusCode.Unauthorized, "old password");
            await PlanAssert.StatusAsync(await AuthKit.LoginAsync(_api, account.Email, newPassword), HttpStatusCode.OK, "new password");

            // PasswordHash updated in DB.
            var hashAfter = await AuthKit.UserColumnAsync("PasswordHash", account.Email);
            Assert.NotEqual(hashBefore?.ToString(), hashAfter?.ToString());
        }
        finally
        {
            if (changed)
            {
                // Restore the original password (not a plan step).
                var restoreLogin = await AuthKit.LoginAsync(_api, account.Email, newPassword);
                if (restoreLogin.StatusCode == HttpStatusCode.OK)
                {
                    var token = (await restoreLogin.JsonAsync()).Str("accessToken");
                    (await _api.PostAsync(ChangePassword, new { currentPassword = newPassword, newPassword = account.Password }, token)).Dispose();
                }
            }
        }
    }

    [SkippableFact(DisplayName = "IT-AUTH-PWD-002 Reject wrong current password or weak new password")]
    [Trait("TestCase", "IT-AUTH-PWD-002")]
    public async Task IT_AUTH_PWD_002()
    {
        var account = PlanSettings.Current.Account("pwdchange");
        var token = await sessions.TokenAsync("pwdchange");
        var hashBefore = AuthKit.DbOn ? await AuthKit.UserColumnAsync("PasswordHash", account.Email) : null;

        var cases = new (string Step, object Payload)[]
        {
            // 1. POST with wrong current password.
            ("wrong current password", new { currentPassword = account.Password + "x", newPassword = AuthKit.NewStrongPassword() }),
            // 2. POST with weak new password.
            ("weak new password", new { currentPassword = account.Password, newPassword = "123" }),
        };

        foreach (var (step, payload) in cases)
        {
            var response = await _api.PostAsync(ChangePassword, payload, token);

            // HTTP 400; message: Mật khẩu hiện tại không đúng hoặc mật khẩu mới không đủ độ phức tạp.
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.BadRequest, step);
            PlanAssert.HasMessage(body, "Mật khẩu hiện tại không đúng hoặc mật khẩu mới không đủ độ phức tạp.", step);
        }

        // Password unchanged in DB.
        Assert.Equal(hashBefore?.ToString(), (await AuthKit.UserColumnAsync("PasswordHash", account.Email))?.ToString());
    }

    [SkippableFact(DisplayName = "IT-AUTH-PWD-003 Forgot password does not disclose account existence")]
    [Trait("TestCase", "IT-AUTH-PWD-003")]
    public async Task IT_AUTH_PWD_003()
    {
        var owner = PlanSettings.Current.Account("owner");

        // 1. POST /api/v1/auth/forgot-password with existing email. 2. POST with unregistered email.
        //    (Field name "userName" from docs/api; the plan only says "email".)
        var existing = await _api.PostAsync(ForgotPassword, new { userName = owner.Email });
        var unknown = await _api.PostAsync(ForgotPassword, new { userName = "ghost@bhome.vn" });

        // HTTP 200; message: Yêu cầu đã được tiếp nhận. Vui lòng kiểm tra email. for both (no existence leaked, GBR-13).
        var existingBody = await PlanAssert.StatusAsync(existing, HttpStatusCode.OK, "existing email");
        var unknownBody = await PlanAssert.StatusAsync(unknown, HttpStatusCode.OK, "unregistered email");
        PlanAssert.HasMessage(existingBody, "Yêu cầu đã được tiếp nhận. Vui lòng kiểm tra email.", "existing email");
        PlanAssert.HasMessage(unknownBody, "Yêu cầu đã được tiếp nhận. Vui lòng kiểm tra email.", "unregistered email");
    }

    [Fact(
        DisplayName = "IT-AUTH-PWD-004 Reset password using one-time token; prevent replay",
        Skip = "Not automatable black-box: the one-time reset token is only delivered by the e-mail adapter (docs/api: delivery is unconfigured, the DB keeps only a SHA-256 grant) and step 3 needs an expired token (server clock). Run manually.")]
    [Trait("TestCase", "IT-AUTH-PWD-004")]
    public void IT_AUTH_PWD_004()
    {
        // Step 1: HTTP 200; message: Đặt lại mật khẩu thành công.
        // Steps 2 & 3: HTTP 400; message: Mã xác thực không hợp lệ hoặc đã hết hạn.
    }
}
