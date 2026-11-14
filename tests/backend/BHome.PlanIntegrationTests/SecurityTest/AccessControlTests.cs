using System.Net;
using BHome.PlanIntegrationTests.LocationAssignment;

namespace BHome.PlanIntegrationTests.SecurityTest;

/// <summary>
/// Sheet "SecurityTest": role x action access control (TC-SEC-001..011, 022, 023).
/// Expected results are copied from the plan; routes/bodies come from docs/api and docs/development only.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "SecurityTest")]
public sealed class AccessControlTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    private static object NewLocationBody(string name) => new { name, address = "Dia chi kiem thu bao mat", isActive = true };

    [SkippableFact(DisplayName = "TC-SEC-001 Anonymous request to a protected API is rejected")]
    [Trait("TestCase", "TC-SEC-001")]
    public async Task TC_SEC_001()
    {
        // Given: no Authorization header. When: GET /api/v1/session; GET /api/v1/locations/assigned-to-me.
        foreach (var path in new[] { "api/v1/session", "api/v1/locations/assigned-to-me" })
        {
            var response = await _api.GetAsync(path);

            // Then: 401 ProblemDetails, no data returned.
            var body = await PlanAssert.StatusAsync(response, HttpStatusCode.Unauthorized, path);
            SecuritySteps.IsProblemDetails(body, 401, path);
            Assert.Null((await response.JsonAsync()).Find("userId"));
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-002 Owner can create a Location")]
    [Trait("TestCase", "TC-SEC-002")]
    public async Task TC_SEC_002()
    {
        // Given: Owner is logged in.
        var owner = await sessions.TokenAsync("owner");

        // When: POST /api/v1/locations.
        var response = await _api.PostAsync("api/v1/locations", NewLocationBody(PlanData.Unique("SEC-002")), owner);

        // Then: 201 Created.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created);
    }

    [SkippableFact(DisplayName = "TC-SEC-003 Staff cannot create a Location")]
    [Trait("TestCase", "TC-SEC-003")]
    public async Task TC_SEC_003()
    {
        // Given: Staff is logged in.
        var staff = await sessions.TokenAsync("staff");
        var name = PlanData.Unique("SEC-003");

        // When: POST /api/v1/locations.
        var response = await _api.PostAsync("api/v1/locations", NewLocationBody(name), staff);

        // Then: 403 Forbidden, nothing is created.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden);
        Assert.Empty(await LocationSteps.SearchLocationsAsync(_api, await sessions.TokenAsync("owner"), name));
    }

    [SkippableFact(DisplayName = "TC-SEC-004 Tenant cannot create a Location")]
    [Trait("TestCase", "TC-SEC-004")]
    public async Task TC_SEC_004()
    {
        // Given: Tenant is logged in. When: POST /api/v1/locations.
        var response = await _api.PostAsync("api/v1/locations", NewLocationBody(PlanData.Unique("SEC-004")), await sessions.TokenAsync("tenant"));

        // Then: 403 Forbidden.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden);
    }

    [SkippableFact(DisplayName = "TC-SEC-005 Staff cannot list all Locations of the chain")]
    [Trait("TestCase", "TC-SEC-005")]
    public async Task TC_SEC_005()
    {
        // Given: Staff is logged in. When: GET /api/v1/locations.
        var response = await _api.GetAsync("api/v1/locations", await sessions.TokenAsync("staff"));

        // Then: 403 Forbidden.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden);
    }

    [SkippableFact(DisplayName = "TC-SEC-006 Tenant cannot list Locations")]
    [Trait("TestCase", "TC-SEC-006")]
    public async Task TC_SEC_006()
    {
        // Given: Tenant is logged in. When: GET /api/v1/locations.
        var response = await _api.GetAsync("api/v1/locations", await sessions.TokenAsync("tenant"));

        // Then: 403 Forbidden.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden);
    }

    [SkippableFact(DisplayName = "TC-SEC-007 Owner and Tenant cannot call the Staff-only assigned-Locations API")]
    [Trait("TestCase", "TC-SEC-007")]
    public async Task TC_SEC_007()
    {
        // Given: Owner or Tenant is logged in. When: GET /api/v1/locations/assigned-to-me.
        foreach (var role in new[] { "owner", "tenant" })
        {
            var response = await _api.GetAsync("api/v1/locations/assigned-to-me", await sessions.TokenAsync(role));

            // Then: 403 Forbidden.
            await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden, role);
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-008 Staff only sees the assigned Locations, not other or future ones")]
    [Trait("TestCase", "TC-SEC-008")]
    public async Task TC_SEC_008()
    {
        // Given: L1 assigned today, L2 assigned from next month, L3 not assigned.
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var l1 = await LocationSteps.CreateLocationAsync(_api, owner);
        var l2 = await LocationSteps.CreateLocationAsync(_api, owner);
        var l3 = await LocationSteps.CreateLocationAsync(_api, owner);
        var today = PlanData.TodayVietnam;
        var nextMonth = new DateOnly(today.Year, today.Month, 1).AddMonths(1);
        await LocationSteps.AssignOkAsync(_api, owner, l1, staffUserId, today, today.AddDays(30));
        await LocationSteps.AssignOkAsync(_api, owner, l2, staffUserId, nextMonth, nextMonth.AddDays(30));

        // When: GET /api/v1/locations/assigned-to-me as that Staff.
        var response = await _api.GetAsync("api/v1/locations/assigned-to-me", await sessions.TokenAsync("staff"));

        // Then: 200 with L1 only.
        await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        var json = await response.JsonAsync();
        Assert.True(LocationSteps.Mentions(json, l1), "L1 (assigned today) is missing.");
        Assert.False(LocationSteps.Mentions(json, l2), "L2 (assigned from next month) must not be returned.");
        Assert.False(LocationSteps.Mentions(json, l3), "L3 (not assigned) must not be returned.");
    }

    [SkippableFact(DisplayName = "TC-SEC-009 Staff and Tenant cannot assign Staff to Locations")]
    [Trait("TestCase", "TC-SEC-009")]
    public async Task TC_SEC_009()
    {
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);
        var start = PlanData.TodayVietnam.AddDays(30);

        // Given: logged in as Staff / Tenant. When: POST /api/v1/staff-location-assignments.
        foreach (var role in new[] { "staff", "tenant" })
        {
            var response = await LocationSteps.AssignAsync(_api, await sessions.TokenAsync(role), locationId, staffUserId, start, start.AddDays(5));

            // Then: 403 Forbidden.
            await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden, role);
        }

        // ... nothing is created.
        Assert.Empty(await LocationSteps.AssignmentsAsync(_api, owner, locationId));
    }

    [SkippableFact(DisplayName = "TC-SEC-010 Each role can only read its own session")]
    [Trait("TestCase", "TC-SEC-010")]
    public async Task TC_SEC_010()
    {
        var roles = new[] { "owner", "staff", "tenant" };
        var logins = new Dictionary<string, LoginSession>();
        foreach (var role in roles)
        {
            logins[role] = await sessions.SessionAsync(role);
        }

        // Given: logged in. When: GET /api/v1/session.
        foreach (var role in roles)
        {
            var response = await _api.GetAsync("api/v1/session", logins[role].AccessToken);

            // Then: 200 with the caller's own identity only.
            await PlanAssert.StatusAsync(response, HttpStatusCode.OK, role);
            var json = await response.JsonAsync();
            Assert.Equal(logins[role].UserId, json.Str("userId"), ignoreCase: true);
            foreach (var other in roles.Where(r => r != role && logins[r].UserId is not null))
            {
                Assert.False(LocationSteps.Mentions(json, logins[other].UserId!), $"{role}: the answer contains the identity of {other}.");
            }
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-011 Fixed permission matrix: each role only reaches its own functions")]
    [Trait("TestCase", "TC-SEC-011")]
    public async Task TC_SEC_011()
    {
        // Given: probe endpoints for owner-only, staff-only, tenant-only and shared permissions. The plan's probe
        // routes exist only in the test host, so product routes are used per docs/api/API_RUNTIME_ROUTES.md:
        // owner-only = staff-assignments.manage, staff-only = locations.view-assigned,
        // tenant-only = invoice-adjustments.request, shared = account.view-own.
        var tokens = new Dictionary<string, string>
        {
            ["owner"] = await sessions.TokenAsync("owner"),
            ["staff"] = await sessions.TokenAsync("staff"),
            ["tenant"] = await sessions.TokenAsync("tenant"),
        };
        var locationId = await LocationSteps.CreateLocationAsync(_api, tokens["owner"]);
        var probes = new (string Group, Func<string, Task<HttpResponseMessage>> Call, string[] Allowed)[]
        {
            ("owner-only", t => _api.GetAsync($"api/v1/staff-location-assignments?locationId={locationId}", t), ["owner"]),
            ("staff-only", t => _api.GetAsync("api/v1/locations/assigned-to-me", t), ["staff"]),
            ("tenant-only", t => _api.PostAsync($"api/v1/invoices/{Guid.NewGuid()}/adjustment-requests", new { }, t), ["tenant"]),
            ("shared", t => _api.GetAsync("api/v1/session", t), ["owner", "staff", "tenant"]),
        };

        // When: call each endpoint with each role.
        foreach (var (group, call, allowed) in probes)
        {
            foreach (var (role, token) in tokens)
            {
                var response = await call(token);
                var step = $"{group} probe as {role}";

                // Then: only the matching role gets 200, the others get 403. The shared endpoint returns 200 for all.
                if (!allowed.Contains(role))
                {
                    await PlanAssert.StatusAsync(response, HttpStatusCode.Forbidden, step);
                }
                else if (group == "tenant-only")
                {
                    // No documented tenant-only route answers 200 without tenant-owned data (an Invoice of the Tenant);
                    // with a random Invoice id the permission check must pass (no 401/403) and the resource is not found.
                    var body = await response.TextAsync();
                    Assert.True(
                        response.StatusCode is not HttpStatusCode.Forbidden and not HttpStatusCode.Unauthorized,
                        $"{step}: the Tenant must pass the tenant-only permission check but got {(int)response.StatusCode}. Body: {body}");
                }
                else
                {
                    await PlanAssert.StatusAsync(response, HttpStatusCode.OK, step);
                }
            }
        }
    }

    [SkippableFact(DisplayName = "TC-SEC-022 Tenant can only view their own Room")]
    [Trait("TestCase", "TC-SEC-022")]
    public async Task TC_SEC_022()
    {
        // Given: Tenant with an active contract on Room 204 (the configured tenant account's own tenancy).
        // Room 205 is created by the Owner in a new Location, so it cannot belong to the Tenant.
        var owner = await sessions.TokenAsync("owner");
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);
        var room205 = await LocationSteps.CreateRoomAsync(_api, owner, locationId, "205");

        // When: request Room 205 (GET /api/v1/rooms/{id}).
        var response = await _api.GetAsync($"api/v1/rooms/{room205}", await sessions.TokenAsync("tenant"));

        // Then: 403/404.
        await PlanAssert.StatusInAsync(response, null, HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }

    [SkippableFact(DisplayName = "TC-SEC-023 Staff cannot read Rooms of an unassigned Location")]
    [Trait("TestCase", "TC-SEC-023")]
    public async Task TC_SEC_023()
    {
        // Given: Staff assigned to L1; a Room in L2.
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var l1 = await LocationSteps.CreateLocationAsync(_api, owner);
        var l2 = await LocationSteps.CreateLocationAsync(_api, owner);
        var today = PlanData.TodayVietnam;
        await LocationSteps.AssignOkAsync(_api, owner, l1, staffUserId, today, today.AddDays(30));
        var roomInL2 = await LocationSteps.CreateRoomAsync(_api, owner, l2, "P201");

        // When: GET Room in L2 as the Staff.
        var response = await _api.GetAsync($"api/v1/rooms/{roomInL2}", await sessions.TokenAsync("staff"));

        // Then: 403/404.
        await PlanAssert.StatusInAsync(response, null, HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }
}
