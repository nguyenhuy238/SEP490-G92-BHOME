using System.Net;

namespace BHome.PlanIntegrationTests.SecurityTest;

/// <summary>
/// Sheet "SecurityTest": generic sign-in failure, stored secrets, append-only audit, sanitized errors (TC-SEC-017..020).
/// Database checks use the tables named in the plan, else docs/database (they skip when BHOME_IT_DB is not set).
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "SecurityTest")]
public sealed class DataProtectionTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "TC-SEC-017 Login failure does not show whether the email exists")]
    [Trait("TestCase", "TC-SEC-017")]
    public async Task TC_SEC_017()
    {
        // Given: one existing and one non-existing email.
        var owner = PlanSettings.Current.Account("owner");
        var unknownEmail = $"ghost-{Guid.NewGuid():N}@bhome.vn";

        // When: POST /auth/login with wrong password / unknown email.
        var wrong = await _api.PostAsync("api/v1/auth/login", new { email = owner.Email, password = owner.Password + "x" });
        var unknown = await _api.PostAsync("api/v1/auth/login", new { email = unknownEmail, password = owner.Password + "x" });

        // Then: same 401 "Sign-in failed." response.
        var wrongBody = await PlanAssert.StatusAsync(wrong, HttpStatusCode.Unauthorized, "wrong password");
        var unknownBody = await PlanAssert.StatusAsync(unknown, HttpStatusCode.Unauthorized, "unknown email");
        PlanAssert.HasMessage(wrongBody, "Sign-in failed.", "wrong password");
        PlanAssert.HasMessage(unknownBody, "Sign-in failed.", "unknown email");
        var w = await wrong.JsonAsync();
        var u = await unknown.JsonAsync();
        Assert.Equal(w.Str("type"), u.Str("type"));
        Assert.Equal(w.Str("title"), u.Str("title"));
        Assert.Equal(w.Str("detail"), u.Str("detail"));
    }

    [SkippableFact(DisplayName = "TC-SEC-018 Database stores only hashes of refresh tokens and passwords")]
    [Trait("TestCase", "TC-SEC-018")]
    public async Task TC_SEC_018()
    {
        // Given: after login/refresh.
        var tenant = PlanSettings.Current.Account("tenant");
        var login = await sessions.NewSessionAsync("tenant");
        Assert.False(string.IsNullOrEmpty(login.RefreshToken), "The login answer has no refreshToken.");
        var refresh = await _api.PostAsync("api/v1/auth/refresh", new { refreshToken = login.RefreshToken });
        await PlanAssert.StatusAsync(refresh, HttpStatusCode.OK, "refresh");
        var rotated = await refresh.JsonAsync();
        var rotatedRefresh = rotated.Str("refreshToken");
        var rotatedAccess = rotated.Str("accessToken");

        try
        {
            // When: check the RefreshTokens and AspNetUsers tables.
            // Then: no raw refresh token or plaintext password is stored.
            Assert.Equal(0L, await PlanDb.CountRowsMentioningAsync("RefreshTokens", login.RefreshToken!));
            if (!string.IsNullOrEmpty(rotatedRefresh))
            {
                Assert.Equal(0L, await PlanDb.CountRowsMentioningAsync("RefreshTokens", rotatedRefresh));
            }

            Assert.Equal(0L, await PlanDb.CountRowsMentioningAsync("AspNetUsers", tenant.Password));
        }
        finally
        {
            if (rotatedAccess is not null)
            {
                (await _api.PostAsync("api/v1/auth/logout", null, rotatedAccess)).Dispose();
            }
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-019 Audit log is append-only")]
    [Trait("TestCase", "TC-SEC-019")]
    public async Task TC_SEC_019()
    {
        // Given: security audit rows exist. The plan does not name the table; docs/database (Compact24) keeps the
        // security audit as record_kind = 'AUDIT' rows of "notifications". A sign-in/sign-out makes sure rows exist.
        var signedIn = await sessions.NewSessionAsync("tenant");
        (await _api.PostAsync("api/v1/auth/logout", null, signedIn.AccessToken)).Dispose();
        var auditId = await PlanDb.ScalarAsync("SELECT id FROM notifications WHERE record_kind = 'AUDIT' ORDER BY event_at DESC LIMIT 1");
        Assert.True(auditId is not null, "Precondition failed: there is no security audit row (notifications.record_kind = 'AUDIT').");

        // When: UPDATE / DELETE / TRUNCATE on the audit table (each in a transaction that is rolled back).
        var update = await SecuritySteps.RejectionAsync(
            "UPDATE notifications SET message = coalesce(message, '') || ' tampered' WHERE id = @id", ("id", auditId));
        var delete = await SecuritySteps.RejectionAsync("DELETE FROM notifications WHERE id = @id", ("id", auditId));
        var truncate = await SecuritySteps.RejectionAsync("TRUNCATE notifications");

        // Then: database rejects the change.
        Assert.True(update is not null, "UPDATE of an audit row was accepted by the database.");
        Assert.True(delete is not null, "DELETE of an audit row was accepted by the database.");
        Assert.True(truncate is not null, "TRUNCATE of the audit table was accepted by the database.");
    }

    [Fact(DisplayName = "TC-SEC-020 Error responses are sanitized and have a correlation id",
        Skip = PlanSkip.FailureInjection + " TC-SEC-020 needs an unexpected server error (500) and an unavailable OCR model (503) to be forced inside the API.")]
    [Trait("TestCase", "TC-SEC-020")]
    public void TC_SEC_020()
    {
    }
}
