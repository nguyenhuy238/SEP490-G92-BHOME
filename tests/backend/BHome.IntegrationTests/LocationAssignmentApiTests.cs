using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class LocationAssignmentApiTests(AuthenticationDatabaseFixture fixture)
    : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic-Location!493";

    [Fact]
    public async Task StaffSeesEveryCurrentlyAssignedLocationAndNotFutureAssignments()
    {
        var owner = await CreateUserAsync(Roles.Owner);
        var staff = await CreateUserAsync(Roles.Staff);
        using var ownerClient = await AuthenticatedClientAsync(owner);
        using var staffClient = await AuthenticatedClientAsync(staff);
        var first = await CreateLocationAsync(ownerClient, "Location Alpha");
        var second = await CreateLocationAsync(ownerClient, "Location Beta");
        var future = await CreateLocationAsync(ownerClient, "Location Future");
        var today = VietnamToday();

        Assert.Equal(HttpStatusCode.Created, (await ownerClient.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = first.Id, staffUserId = staff.Id, startDate = today.AddDays(-1), endDate = today.AddDays(1) })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await ownerClient.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = second.Id, staffUserId = staff.Id, startDate = today, endDate = today })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await ownerClient.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = future.Id, staffUserId = staff.Id, startDate = today.AddDays(1), endDate = today.AddDays(2) })).StatusCode);

        var response = await staffClient.GetAsync("/api/v1/locations/assigned-to-me");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var locations = (await response.Content.ReadFromJsonAsync<LocationSummary[]>())!;
        Assert.Equal(new[] { first.Id, second.Id }.Order(), locations.Select(x => x.Id).Order());
    }

    [Fact]
    public async Task LocationRejectsOverlappingAssignmentsButAllowsAdjacentDates()
    {
        var owner = await CreateUserAsync(Roles.Owner);
        var firstStaff = await CreateUserAsync(Roles.Staff);
        var secondStaff = await CreateUserAsync(Roles.Staff);
        using var client = await AuthenticatedClientAsync(owner);
        var location = await CreateLocationAsync(client, "No Overlap Location");
        var start = VietnamToday();
        var end = start.AddDays(5);

        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = firstStaff.Id, startDate = start, endDate = end })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = secondStaff.Id, startDate = end, endDate = end.AddDays(1) })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = secondStaff.Id, startDate = end.AddDays(1), endDate = end.AddDays(2) })).StatusCode);
    }

    [Fact]
    public async Task EveryOwnerCanManageEveryLocationAndEveryStaffAccount()
    {
        var firstOwner = await CreateUserAsync(Roles.Owner);
        var secondOwner = await CreateUserAsync(Roles.Owner);
        var firstStaff = await CreateUserAsync(Roles.Staff);
        var secondStaff = await CreateUserAsync(Roles.Staff);
        using var firstClient = await AuthenticatedClientAsync(firstOwner);
        using var secondClient = await AuthenticatedClientAsync(secondOwner);
        var location = await CreateLocationAsync(firstClient, "Private Location");
        var today = VietnamToday();

        Assert.Equal(HttpStatusCode.OK,
            (await secondClient.GetAsync($"/api/v1/staff-location-assignments?locationId={location.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await secondClient.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = secondStaff.Id, startDate = today, endDate = today })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await firstClient.PostAsJsonAsync(
            "/api/v1/staff-location-assignments",
            new { locationId = location.Id, staffUserId = firstStaff.Id, startDate = today, endDate = today })).StatusCode);
    }

    [Fact]
    public async Task ConcurrentRequestsCreateAtMostOneAssignmentForTheSameLocationAndDates()
    {
        var owner = await CreateUserAsync(Roles.Owner);
        var firstStaff = await CreateUserAsync(Roles.Staff);
        var secondStaff = await CreateUserAsync(Roles.Staff);
        using var setupClient = await AuthenticatedClientAsync(owner);
        var location = await CreateLocationAsync(setupClient, "Concurrent Location");
        var session = await LoginAsync(setupClient, owner);
        using var firstClient = fixture.Factory.CreateClient();
        using var secondClient = fixture.Factory.CreateClient();
        firstClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        secondClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var start = VietnamToday().AddDays(20);
        var end = start.AddDays(2);

        var requests = new[]
        {
            firstClient.PostAsJsonAsync("/api/v1/staff-location-assignments",
                new { locationId = location.Id, staffUserId = firstStaff.Id, startDate = start, endDate = end }),
            secondClient.PostAsJsonAsync("/api/v1/staff-location-assignments",
                new { locationId = location.Id, staffUserId = secondStaff.Id, startDate = start, endDate = end })
        };
        var responses = await Task.WhenAll(requests);
        Assert.Equal(1, responses.Count(x => x.StatusCode == HttpStatusCode.Created));
        Assert.Equal(1, responses.Count(x => x.StatusCode == HttpStatusCode.Conflict));
    }

    private async Task<ApplicationUser> CreateUserAsync(string role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser
        {
            Id = id,
            UserName = id.ToString(),
            Email = $"{id:N}@example.invalid"
        };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private async Task<HttpClient> AuthenticatedClientAsync(ApplicationUser user)
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

    private static async Task<LocationSummary> CreateLocationAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/v1/locations", new { name });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LocationSummary>())!;
    }

    private static DateOnly VietnamToday() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow,
        TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
}
