using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class PermissionApiTests(AuthenticationDatabaseFixture fixture) : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic-Permission!493";

    [Theory]
    [InlineData(Roles.Owner, "permission-owner", HttpStatusCode.OK)]
    [InlineData(Roles.Staff, "permission-owner", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Tenant, "permission-owner", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Owner, "permission-staff", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Staff, "permission-staff", HttpStatusCode.OK)]
    [InlineData(Roles.Tenant, "permission-staff", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Owner, "permission-tenant", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Staff, "permission-tenant", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Tenant, "permission-tenant", HttpStatusCode.OK)]
    [InlineData(Roles.Owner, "permission-shared", HttpStatusCode.OK)]
    [InlineData(Roles.Staff, "permission-shared", HttpStatusCode.OK)]
    [InlineData(Roles.Tenant, "permission-shared", HttpStatusCode.OK)]
    public async Task RealJwtAndDatabaseStateEnforceFixedPermissionMatrix(string role, string path, HttpStatusCode expected)
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, role);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var response = await client.GetAsync("/test-probes/" + path);
        Assert.Equal(expected, response.StatusCode);
        if (expected == HttpStatusCode.Forbidden)
        {
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            Assert.True(await db.SecurityAudit.AnyAsync(x => x.UserId == session.UserId &&
                x.SessionId == session.SessionId && x.Event == "Forbidden"));
        }
    }

    [Fact]
    public async Task PermissionEndpointRejectsAnonymous()
    {
        using var client = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/test-probes/permission-owner")).StatusCode);
    }

    [Fact]
    public async Task PermissionClaimsCannotElevateATenantToOwnerFunctions()
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, Roles.Tenant);
        using var scope = fixture.Factory.Services.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        var original = new JwtSecurityTokenHandler().ReadJwtToken(session.AccessToken);
        var claims = original.Claims.Where(x => x.Type is "sub" or "role" or "sid" or "sstamp" or "jti").ToList();
        claims.Add(new("permission", Permissions.StaffAccounts.Manage));
        var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(options.Issuer, options.Audience, claims,
            DateTime.UtcNow.AddSeconds(-1), DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey)), SecurityAlgorithms.HmacSha256)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/test-probes/permission-shared")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/test-probes/permission-owner")).StatusCode);
    }

    [Fact]
    public async Task RoleRemovalImmediatelyInvalidatesPreviouslyAuthorizedPermissionRequests()
    {
        using var client = fixture.Factory.CreateClient();
        var session = await Login(client, Roles.Owner);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/test-probes/permission-owner")).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await users.FindByIdAsync(session.UserId.ToString()))!;
        Assert.True((await users.RemoveFromRoleAsync(user, Roles.Owner)).Succeeded);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/test-probes/permission-owner")).StatusCode);
    }

    private async Task<LoginResult> Login(HttpClient client, string role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid" };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResult>())!;
    }
}
