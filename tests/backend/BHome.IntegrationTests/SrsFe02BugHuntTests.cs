using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

// QA tests derived from SRS v1.3 (FE-02 §2.1-2.3, UC-01/02/04/08, Permission Matrix I.4.4, GBR-01/02, NFR §2.3/2.5).
// Each test states the requirement it checks; a failing test is a candidate defect, not a broken test.
[Trait("Category", "Docker")]
[Trait("Suite", "QA-BugHunt")]
public sealed class SrsFe02BugHuntTests(AuthenticationDatabaseFixture fixture)
    : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic-BugHunt!731";

    // ---------- UC-04 Manage Locations: A1 "Invalid or duplicate data: BHOME rejects the change"

    [Fact]
    public async Task Uc04_DuplicateLocationNameIsRejected()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var name = $"Hunt Duplicate {Guid.NewGuid():N}"[..30];
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/v1/locations", new { name })).StatusCode);

        var second = await owner.PostAsJsonAsync("/api/v1/locations", new { name });

        Assert.True(second.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.BadRequest,
            $"SRS UC-04 A1 expects duplicate Location data to be rejected, got {(int)second.StatusCode}.");
    }

    [Fact]
    public async Task Uc04_DuplicateLocationNameDifferingOnlyByCaseOrSpacesIsRejected()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var name = $"Hunt Case {Guid.NewGuid():N}"[..25];
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync("/api/v1/locations", new { name })).StatusCode);

        var second = await owner.PostAsJsonAsync("/api/v1/locations", new { name = $"  {name.ToUpperInvariant()}  " });

        Assert.True(second.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.BadRequest,
            $"Same Location name in another case/with spaces should be treated as duplicate, got {(int)second.StatusCode}.");
    }

    [Fact]
    public async Task Uc04_NameThatTrimsBelowTwoCharactersIsRejected()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);

        var response = await owner.PostAsJsonAsync("/api/v1/locations", new { name = " A " });

        Assert.True(response.StatusCode == HttpStatusCode.BadRequest,
            $"Name \" A \" becomes \"A\" (1 char) after trimming; minimum is 2. Got {(int)response.StatusCode} " +
            $"{await response.Content.ReadAsStringAsync()}");
    }

    [Fact]
    public async Task Uc04_ValidNameIsStoredWithoutSurroundingSpaces()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var core = $"Tan Binh {Guid.NewGuid():N}"[..17];

        var response = await owner.PostAsJsonAsync("/api/v1/locations", new { name = $"  {core}  " });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(core, (await response.Content.ReadFromJsonAsync<LocationSummary>())!.Name);
    }

    [Theory]
    [InlineData(1, HttpStatusCode.BadRequest)]
    [InlineData(2, HttpStatusCode.Created)]
    [InlineData(200, HttpStatusCode.Created)]
    [InlineData(201, HttpStatusCode.BadRequest)]
    public async Task Uc04_LocationNameLengthBoundaries(int length, HttpStatusCode expected)
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var name = (Guid.NewGuid().ToString("N") + new string('x', 300))[..length];

        var response = await owner.PostAsJsonAsync("/api/v1/locations", new { name });

        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Uc04_VietnameseLocationNameOf200CharactersIsAccepted()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var name = (Guid.NewGuid().ToString("N")[..8] + string.Concat(Enumerable.Repeat("Nhà trọ Tân Bình ", 20)))[..200];

        var response = await owner.PostAsJsonAsync("/api/v1/locations", new { name });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(name.Trim(), (await response.Content.ReadFromJsonAsync<LocationSummary>())!.Name);
    }

    // ---------- UC-08 Staff Location assignment (Owner assigns an active Staff account)

    [Theory]
    [InlineData(Roles.Owner)]
    [InlineData(Roles.Tenant)]
    public async Task Uc08_OnlyStaffAccountsCanBeAssignedToALocation(string role)
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var notStaff = await CreateUserAsync(role);

        var response = await AssignAsync(owner, location.Id, notStaff.Id, Today(), Today().AddDays(3));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Uc08_InactiveStaffCannotBeAssigned()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var staff = await CreateUserAsync(Roles.Staff, active: false);

        var response = await AssignAsync(owner, location.Id, staff.Id, Today(), Today().AddDays(3));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Uc08_UnknownStaffIdIsRejectedWithoutServerError()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);

        var response = await AssignAsync(owner, location.Id, Guid.NewGuid(), Today(), Today().AddDays(3));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Uc08_AssignmentToUnknownLocationReturns404()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var staff = await CreateUserAsync(Roles.Staff);

        var response = await AssignAsync(owner, Guid.NewGuid(), staff.Id, Today(), Today().AddDays(3));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Uc08_PeriodsSharingTheBoundaryDayOverlap()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var start = Today().AddDays(30);
        Assert.Equal(HttpStatusCode.Created,
            (await AssignAsync(owner, location.Id, (await CreateUserAsync(Roles.Staff)).Id, start, start.AddDays(4))).StatusCode);

        var sameEndDay = await AssignAsync(owner, location.Id, (await CreateUserAsync(Roles.Staff)).Id, start.AddDays(4), start.AddDays(6));

        Assert.Equal(HttpStatusCode.Conflict, sameEndDay.StatusCode);
    }

    [Theory]
    [InlineData(0, 0, true)]     // single-day assignment for today
    [InlineData(-5, 0, true)]    // ends today (inclusive)
    [InlineData(0, 5, true)]     // starts today
    [InlineData(-5, -1, false)]  // ended yesterday
    [InlineData(1, 5, false)]    // starts tomorrow
    public async Task Gbr02_StaffSeesALocationOnlyWhileTheAssignmentIsActive(int startOffset, int endOffset, bool visible)
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var staff = await CreateUserAsync(Roles.Staff);
        using var staffClient = await ClientForAsync(staff);
        var location = await CreateLocationAsync(owner);
        Assert.Equal(HttpStatusCode.Created,
            (await AssignAsync(owner, location.Id, staff.Id, Today().AddDays(startOffset), Today().AddDays(endOffset))).StatusCode);

        var assigned = await staffClient.GetFromJsonAsync<LocationSummary[]>("/api/v1/locations/assigned-to-me");

        Assert.Equal(visible, assigned!.Any(x => x.Id == location.Id));
    }

    [Theory]
    [InlineData("2026-02-30", "2026-03-02")]
    [InlineData("30/10/2026", "31/10/2026")]
    [InlineData("", "2026-11-01")]
    public async Task Uc08_MalformedDatesAreValidationErrors(string start, string end)
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var staff = await CreateUserAsync(Roles.Staff);

        var response = await owner.PostAsJsonAsync("/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = staff.Id, startDate = start, endDate = end });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Uc08_ExtremeDatesNeverCauseAServerError()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var staff = await CreateUserAsync(Roles.Staff);

        var response = await AssignAsync(owner, location.Id, staff.Id, DateOnly.MinValue, DateOnly.MaxValue);

        Assert.True((int)response.StatusCode < 500,
            $"Extreme dates must be accepted or rejected as 4xx, got {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
    }

    [Fact]
    public async Task Uc08_ConcurrentAssignmentsForTheSamePeriodNeverReturnServerErrors()
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var token = owner.DefaultRequestHeaders.Authorization!;
        var failures = new List<string>();
        for (var round = 0; round < 8; round++)
        {
            var location = await CreateLocationAsync(owner);
            var staff = new List<ApplicationUser>();
            for (var i = 0; i < 5; i++) staff.Add(await CreateUserAsync(Roles.Staff));
            var start = Today().AddDays(40 + round);
            var clients = staff.Select(_ => { var c = fixture.Factory.CreateClient(); c.DefaultRequestHeaders.Authorization = token; return c; }).ToList();
            var responses = await Task.WhenAll(clients.Select((c, i) => AssignAsync(c, location.Id, staff[i].Id, start, start.AddDays(2))));
            var codes = responses.Select(r => (int)r.StatusCode).ToArray();
            if (codes.Count(x => x == 201) != 1 || codes.Any(x => x != 201 && x != 409))
                failures.Add($"round {round}: [{string.Join(",", codes)}] {string.Join(" | ", await Task.WhenAll(responses.Where(r => (int)r.StatusCode >= 500).Select(r => r.Content.ReadAsStringAsync())))}");
            clients.ForEach(c => c.Dispose());
        }

        Assert.True(failures.Count == 0, "Expected exactly one 201 and only 409 for the rest:\n" + string.Join("\n", failures));
    }

    // ---------- Permission Matrix I.4.4 / GBR-02: Staff and Tenant cannot read Owner-only assignment data

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task Gbr02_NonOwnerCannotReadAssignmentHistoryEvenForTheirOwnLocation(string role)
    {
        using var owner = await ClientForNewUserAsync(Roles.Owner);
        var location = await CreateLocationAsync(owner);
        var user = await CreateUserAsync(role);
        if (role == Roles.Staff)
            Assert.Equal(HttpStatusCode.Created, (await AssignAsync(owner, location.Id, user.Id, Today(), Today().AddDays(2))).StatusCode);
        using var client = await ClientForAsync(user);

        var existing = await client.GetAsync($"/api/v1/staff-location-assignments?locationId={location.Id}");
        var missing = await client.GetAsync($"/api/v1/staff-location-assignments?locationId={Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Forbidden, existing.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, missing.StatusCode); // same answer: no Location existence leak
    }

    // ---------- UC-01 Sign In + NFR §2.3/2.5: no secrets or personal data leak

    [Fact]
    public async Task Uc01_LoginResponseContainsOnlySessionFields()
    {
        var user = await CreateUserAsync(Roles.Tenant);
        using var client = fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var allowed = new[] { "userId", "roles", "accessToken", "expiresAt", "sessionId", "refreshToken", "sessionExpiresAt" };
        var extra = json.RootElement.EnumerateObject().Select(p => p.Name).Where(n => !allowed.Contains(n, StringComparer.OrdinalIgnoreCase)).ToArray();
        Assert.True(extra.Length == 0, "Unexpected login response fields: " + string.Join(", ", extra));
        var body = json.RootElement.GetRawText();
        Assert.DoesNotContain(Password, body);
        Assert.DoesNotContain("PasswordHash", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Uc01_AccessTokenDoesNotCarryEmailOrPassword()
    {
        var user = await CreateUserAsync(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        var session = await LoginAsync(client, user);

        var payload = DecodeJwtPayload(session.AccessToken);

        Assert.DoesNotContain(user.Email!, payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Password, payload);
    }

    [Fact]
    public async Task Uc01_FailedLoginNeverEchoesTheSubmittedPassword()
    {
        var user = await CreateUserAsync(Roles.Owner);
        using var client = fixture.Factory.CreateClient();
        const string marker = "Leak-Marker-Password!987";

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = marker });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.DoesNotContain(marker, await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("  {0}  ")]
    [InlineData("{1}")]
    public async Task Uc01_EmailIsAcceptedWithSurroundingSpacesAndInAnyCase(string format)
    {
        var user = await CreateUserAsync(Roles.Staff);
        using var client = fixture.Factory.CreateClient();
        var email = string.Format(format, user.Email, user.Email!.ToUpperInvariant());

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Uc01_ForgotPasswordUsesTheSameLoginIdentifierAsSignIn()
    {
        var user = await CreateUserAsync(Roles.Tenant);
        using var client = fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = user.Email });

        Assert.True(response.StatusCode != HttpStatusCode.BadRequest,
            "Sign In uses email (SRS §2.1.1 Login Identifier) but forgot-password rejects an email-only request: " +
            await response.Content.ReadAsStringAsync());
    }

    // ---------- UC-02 Sign Out

    [Fact]
    public async Task Uc02_AfterSignOutTheOldAccessTokenCannotReachAnyProtectedApi()
    {
        var owner = await CreateUserAsync(Roles.Owner);
        using var client = await ClientForAsync(owner);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/locations")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/logout", new { })).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/locations")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/locations", new { name = "After logout" })).StatusCode);
    }

    // ---------- helpers

    private async Task<ApplicationUser> CreateUserAsync(string role, bool active = true)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"hunt.{id:N}@example.invalid" };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        if (!active)
        {
            user.IsActive = false;
            Assert.True((await users.UpdateAsync(user)).Succeeded);
        }
        return user;
    }

    private async Task<HttpClient> ClientForNewUserAsync(string role) => await ClientForAsync(await CreateUserAsync(role));

    private async Task<HttpClient> ClientForAsync(ApplicationUser user)
    {
        var client = fixture.Factory.CreateClient();
        var session = await LoginAsync(client, user);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return client;
    }

    private static async Task<LoginResult> LoginAsync(HttpClient client, ApplicationUser user)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResult>())!;
    }

    private static async Task<LocationSummary> CreateLocationAsync(HttpClient owner)
    {
        var response = await owner.PostAsJsonAsync("/api/v1/locations", new { name = $"Hunt {Guid.NewGuid():N}" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LocationSummary>())!;
    }

    private static Task<HttpResponseMessage> AssignAsync(HttpClient owner, Guid locationId, Guid staffUserId, DateOnly start, DateOnly end) =>
        owner.PostAsJsonAsync("/api/v1/staff-location-assignments",
            new { locationId, staffUserId, startDate = start, endDate = end });

    private static string DecodeJwtPayload(string jwt)
    {
        var part = jwt.Split('.')[1].Replace('-', '+').Replace('_', '/');
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(part.PadRight(part.Length + (4 - part.Length % 4) % 4, '=')));
    }

    private static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow,
        TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
}
