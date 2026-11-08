using System.Net;
using System.Text.Json.Nodes;
using BHome.PlanIntegrationTests.LocationAssignment;

namespace BHome.PlanIntegrationTests.SecurityTest;

/// <summary>
/// Sheet "SecurityTest": tokens, sessions and web refresh cookie (TC-SEC-012..016, 021).
/// Tampered tokens are built by editing the JWT segments of a real token (black-box, no signing key).
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "SecurityTest")]
public sealed class TokenSessionTests(PlanSessions sessions)
{
    /// <summary>Identity table per docs/database (Compact24 "users"); the plan does not name it.</summary>
    private const string UsersByEmail = "lower(email) = lower(@e)";

    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "TC-SEC-012 Tenant cannot get Owner functions by adding claims to the token")]
    [Trait("TestCase", "TC-SEC-012")]
    public async Task TC_SEC_012()
    {
        // Given: Tenant token with extra role/permission claims.
        var tenant = await sessions.TokenAsync("tenant");
        var tampered = SecuritySteps.WithPayload(tenant, p =>
        {
            p["role"] = new JsonArray("Tenant", "Owner");
            p["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] = "Owner";
            p["permission"] = new JsonArray("locations.manage", "staff-assignments.manage", "property.manage");
        });

        // When: call an Owner-only API (POST /api/v1/locations, locations.manage).
        var response = await _api.PostAsync(
            "api/v1/locations",
            new { name = PlanData.Unique("SEC-012"), address = "Dia chi kiem thu", isActive = true },
            tampered);

        // Then: 401/403, not 200.
        await PlanAssert.StatusInAsync(response, null, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [SkippableFact(DisplayName = "TC-SEC-013 Forged or invalid JWT is rejected")]
    [Trait("TestCase", "TC-SEC-013")]
    public async Task TC_SEC_013()
    {
        // Given: a real Owner token (accepted as is) and variants of it.
        var token = await sessions.TokenAsync("owner");
        await PlanAssert.StatusAsync(await _api.GetAsync("api/v1/session", token), HttpStatusCode.OK, "precondition: the untouched token works");
        var header = SecuritySteps.Header(token);
        var signature = SecuritySteps.Signature(token);
        var badSignature = (signature[0] == 'A' ? "B" : "A") + signature[1..];
        var noneHeader = new JsonObject { ["alg"] = "none", ["typ"] = "JWT" };
        var hs512Header = SecuritySteps.Header(token);
        hs512Header["alg"] = "HS512";

        var variants = new Dictionary<string, string>
        {
            ["bad signature"] = SecuritySteps.Build(header, SecuritySteps.Payload(token), badSignature),
            ["wrong issuer"] = SecuritySteps.WithPayload(token, p => p["iss"] = "https://evil.example"),
            ["wrong audience"] = SecuritySteps.WithPayload(token, p => p["aud"] = "evil-audience"),
            ["algorithm none"] = SecuritySteps.Build(noneHeader, SecuritySteps.Payload(token), string.Empty),
            ["wrong algorithm HS512"] = SecuritySteps.Build(hs512Header, SecuritySteps.Payload(token), signature),
            ["expired"] = SecuritySteps.WithPayload(token, p =>
            {
                p["exp"] = SecuritySteps.UnixNow - 3600;
                p["nbf"] = SecuritySteps.UnixNow - 7200;
                p["iat"] = SecuritySteps.UnixNow - 7200;
            }),
            ["foreign session"] = SecuritySteps.WithPayload(token, p => p["sid"] = Guid.NewGuid().ToString()),
            ["missing session"] = SecuritySteps.WithPayload(token, p => p.Remove("sid")),
            ["role escalation"] = SecuritySteps.WithPayload(token, p => p["role"] = new JsonArray("Owner", "Staff", "Tenant")),
        };

        // A correctly signed token whose server session no longer exists (signed out).
        var signedOut = await sessions.NewSessionAsync("owner");
        await PlanAssert.SuccessAsync(await _api.PostAsync("api/v1/auth/logout", null, signedOut.AccessToken), "precondition: sign out");
        variants["revoked session"] = signedOut.AccessToken;

        // When: call a protected API with each variant.
        foreach (var (name, forged) in variants)
        {
            var response = await _api.GetAsync("api/v1/session", forged);

            // Then: 401 for every variant.
            await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized, name);
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-014 A correctly signed JWT without a server session is rejected")]
    [Trait("TestCase", "TC-SEC-014")]
    public async Task TC_SEC_014()
    {
        // Given: JWT signed with the real key but no session row. Signing needs the API's Jwt:SigningKey.
        var key = Environment.GetEnvironmentVariable(SecuritySteps.SigningKeyVariable);
        Skip.If(
            string.IsNullOrWhiteSpace(key),
            $"TC-SEC-014 needs the API signing key (Jwt:SigningKey user-secret) to sign a token without a session. Set {SecuritySteps.SigningKeyVariable}.");

        foreach (var role in new[] { "owner", "staff", "tenant" })
        {
            var real = await sessions.TokenAsync(role);
            var header = SecuritySteps.Header(real);

            // The key is right only if re-signing the untouched claims gives an accepted token.
            var resigned = SecuritySteps.SignHs256(header, SecuritySteps.Payload(real), key!);
            var check = await _api.GetAsync("api/v1/session", resigned);
            Skip.If(check.StatusCode != HttpStatusCode.OK, $"{SecuritySteps.SigningKeyVariable} does not match the API signing key (re-signed real token got {(int)check.StatusCode}).");

            var payload = SecuritySteps.Payload(real);
            payload["sid"] = Guid.NewGuid().ToString();
            payload["jti"] = Guid.NewGuid().ToString();
            var noSession = SecuritySteps.SignHs256(header, payload, key!);

            // When: call a protected API.
            var response = await _api.GetAsync("api/v1/session", noSession);

            // Then: 401 for each role.
            await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized, role);
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-015 Removing a role blocks requests that were allowed before")]
    [Trait("TestCase", "TC-SEC-015")]
    public async Task TC_SEC_015()
    {
        // Given: Owner is logged in, Owner-only API returns 200. A dedicated account is used ("roletest", must have the
        // Owner role; Compact24 allows a single Owner, so run this on a disposable database). Roles are restored after.
        var account = PlanSettings.Current.Account("roletest");
        var login = await PlanSessions.LoginAsync(_api, account);
        Skip.IfNot(SecuritySteps.Roles(login.Body).Contains("Owner"), "Account 'roletest' must have the Owner role for TC-SEC-015.");
        var originalRoles = await PlanDb.ScalarAsync($"SELECT roles FROM users WHERE {UsersByEmail}", ("e", account.Email)) as string[];
        Assert.NotNull(originalRoles);
        var locationId = await LocationSteps.CreateLocationAsync(_api, login.AccessToken);
        var ownerOnly = $"api/v1/staff-location-assignments?locationId={locationId}";
        await PlanAssert.StatusAsync(await _api.GetAsync(ownerOnly, login.AccessToken), HttpStatusCode.OK, "before role removal");

        try
        {
            // When: remove the Owner role (in PostgreSQL), then call the same API with the same token.
            await PlanDb.ExecuteAsync(
                $"UPDATE users SET roles = CASE WHEN cardinality(array_remove(roles, 'Owner')) > 0 THEN array_remove(roles, 'Owner') ELSE ARRAY['Tenant']::text[] END WHERE {UsersByEmail}",
                ("e", account.Email));
            var response = await _api.GetAsync(ownerOnly, login.AccessToken);

            // Then: 401/403 on the next request.
            await PlanAssert.StatusInAsync(response, "after role removal", HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
        }
        finally
        {
            await PlanDb.ExecuteAsync($"UPDATE users SET roles = @r WHERE {UsersByEmail}", ("r", originalRoles), ("e", account.Email));
            sessions.Forget(account.Name);
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-016 Logged-out or deactivated user cannot keep using the token")]
    [Trait("TestCase", "TC-SEC-016")]
    public async Task TC_SEC_016()
    {
        // Given: valid token. When: logout, then call a protected API.
        var signedIn = await sessions.NewSessionAsync("tenant");
        await PlanAssert.StatusAsync(await _api.GetAsync("api/v1/session", signedIn.AccessToken), HttpStatusCode.OK, "before logout");
        await PlanAssert.SuccessAsync(await _api.PostAsync("api/v1/auth/logout", null, signedIn.AccessToken), "logout");

        // Then: 401.
        await PlanAssert.StatusAsync(await _api.GetAsync("api/v1/session", signedIn.AccessToken), HttpStatusCode.Unauthorized, "after logout");

        // Given: valid token of a dedicated account ("roletest"). When: deactivate the account (PostgreSQL), then call.
        var account = PlanSettings.Current.Account("roletest");
        var login = await PlanSessions.LoginAsync(_api, account);
        await PlanAssert.StatusAsync(await _api.GetAsync("api/v1/session", login.AccessToken), HttpStatusCode.OK, "before deactivation");
        try
        {
            await PlanDb.ExecuteAsync($"UPDATE users SET is_active = false WHERE {UsersByEmail}", ("e", account.Email));

            // Then: 401.
            await PlanAssert.StatusAsync(await _api.GetAsync("api/v1/session", login.AccessToken), HttpStatusCode.Unauthorized, "after deactivation");
        }
        finally
        {
            await PlanDb.ExecuteAsync($"UPDATE users SET is_active = true WHERE {UsersByEmail}", ("e", account.Email));
            sessions.Forget(account.Name);
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-021 Web refresh cookie is HttpOnly/Secure/Strict and needs Origin + custom header")]
    [Trait("TestCase", "TC-SEC-021")]
    public async Task TC_SEC_021()
    {
        // Given: web transport (docs: X-BHome-Client: web + exact Origin; the API's own origin is accepted).
        var owner = PlanSettings.Current.Account("owner");
        var origin = $"{_api.BaseUrl.Scheme}://{_api.BaseUrl.Authority}";
        var login = await _api.PostAsync(
            "api/v1/auth/login",
            new { email = owner.Email, password = owner.Password },
            headers: new Dictionary<string, string> { ["X-BHome-Client"] = "web", ["Origin"] = origin });
        await PlanAssert.StatusAsync(login, HttpStatusCode.OK, "web login");
        var accessToken = (await login.JsonAsync()).Str("accessToken");

        // Then (part): cookie flags are correct.
        var cookie = login.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(v => v.StartsWith("__Secure-bhome-refresh=", StringComparison.Ordinal))
            : null;
        Assert.True(cookie is not null, "The web login did not set the __Secure-bhome-refresh cookie.");
        var flags = cookie!.Split(';').Select(f => f.Trim().ToLowerInvariant()).ToArray();
        Assert.Contains("httponly", flags);
        Assert.Contains("secure", flags);
        Assert.Contains("samesite=strict", flags);
        Assert.Contains("path=/api/v1/auth", flags);
        var cookiePair = cookie.Split(';')[0];

        try
        {
            // When: refresh without the X-BHome-Client header.
            var noHeader = await _api.PostAsync(
                "api/v1/auth/refresh",
                new { },
                headers: new Dictionary<string, string> { ["Origin"] = origin, ["Cookie"] = cookiePair });

            // Then: rejected (400/403).
            await PlanAssert.StatusInAsync(noHeader, "refresh without X-BHome-Client", HttpStatusCode.BadRequest, HttpStatusCode.Forbidden);

            // When: refresh with a foreign Origin.
            var foreign = await _api.PostAsync(
                "api/v1/auth/refresh",
                new { },
                headers: new Dictionary<string, string> { ["X-BHome-Client"] = "web", ["Origin"] = "https://evil.example", ["Cookie"] = cookiePair });

            // Then: rejected (400/403).
            await PlanAssert.StatusInAsync(foreign, "refresh with a foreign Origin", HttpStatusCode.BadRequest, HttpStatusCode.Forbidden);
        }
        finally
        {
            if (accessToken is not null)
            {
                (await _api.PostAsync("api/v1/auth/logout", null, accessToken)).Dispose();
            }
        }
    }
}
