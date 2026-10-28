using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class PostgresAuthenticationTests(AuthenticationDatabaseFixture fixture) : IClassFixture<AuthenticationDatabaseFixture>
{
    // Synthetic credentials exist only in the disposable test database.
    private const string TestPassword = "Test-only!Password-493";

    [Theory]
    [InlineData(Roles.Owner, HttpStatusCode.OK)]
    [InlineData(Roles.Staff, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Tenant, HttpStatusCode.Forbidden)]
    public async Task LoginVerifiesStoredPasswordAndRolesThenAuthenticatesSession(string role, HttpStatusCode ownerAccess)
    {
        var user = await CreateUserAsync(role);
        using var client = fixture.Factory.CreateClient();
        // An extra client-supplied role must not influence the issued JWT.
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            userName = user.UserName,
            password = TestPassword,
            roles = new[] { Roles.Owner }
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var session = await response.Content.ReadFromJsonAsync<LoginResult>();
        Assert.NotNull(session);
        Assert.Equal(user.Id, session.UserId);
        Assert.Equal([role], session.Roles);
        Assert.InRange(session.ExpiresAt, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(16));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var current = await client.GetFromJsonAsync<SessionIdentity>("/api/v1/session");
        Assert.Equal(user.Id, current?.UserId);
        Assert.Equal(ownerAccess, (await client.GetAsync("/test-probes/owner")).StatusCode);
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("wrong-password")]
    [InlineData("locked")]
    [InlineData("no-role")]
    [InlineData("two-factor")]
    [InlineData("unsupported-role")]
    [InlineData("inactive")]
    public async Task UnsupportedOrFailedSignInReturnsSameGenericDenial(string scenario)
    {
        var user = await CreateUserAsync(scenario == "no-role" ? null : Roles.Staff);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var stored = await users.FindByIdAsync(user.Id.ToString());
            Assert.NotNull(stored);
            if (scenario == "locked")
                Assert.True((await users.SetLockoutEndDateAsync(stored, DateTimeOffset.UtcNow.AddMinutes(15))).Succeeded);
            if (scenario == "two-factor")
                Assert.True((await users.SetTwoFactorEnabledAsync(stored, true)).Succeeded);
            if (scenario == "inactive")
            {
                stored.IsActive = false;
                Assert.True((await users.UpdateAsync(stored)).Succeeded);
            }
            if (scenario == "unsupported-role")
            {
                var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
                if (!await roles.RoleExistsAsync("Unsupported"))
                    Assert.True((await roles.CreateAsync(new IdentityRole<Guid>("Unsupported"))).Succeeded);
                Assert.True((await users.AddToRoleAsync(stored, "Unsupported")).Succeeded);
            }
        }

        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            userName = scenario == "unknown" ? Guid.NewGuid().ToString() : user.UserName,
            password = scenario == "wrong-password" ? "wrong-password" : TestPassword
        });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Sign-in failed.", body);
        Assert.DoesNotContain("accessToken", body);
        Assert.DoesNotContain(user.UserName!, body);
        Assert.DoesNotContain(TestPassword, body);
    }

    [Fact]
    public async Task RepeatedWrongPasswordsLockThePersistedAccount()
    {
        var user = await CreateUserAsync(Roles.Staff);
        using var client = fixture.Factory.CreateClient();
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { userName = user.UserName, password = "wrong-password" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        var correctPassword = await client.PostAsJsonAsync("/api/v1/auth/login", new { userName = user.UserName, password = TestPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, correctPassword.StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var stored = await users.FindByIdAsync(user.Id.ToString());
        Assert.NotNull(stored);
        Assert.True(await users.IsLockedOutAsync(stored));
    }

    private async Task<ApplicationUser> CreateUserAsync(string? role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid", LockoutEnabled = true };
        var created = await users.CreateAsync(user, TestPassword);
        Assert.True(created.Succeeded, string.Join(", ", created.Errors.Select(error => error.Code)));
        if (role is not null) Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private sealed record SessionIdentity(Guid? UserId);
}

public sealed class AuthenticationDatabaseFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").Build();
    public ApiFactory Factory { get; } = new();

    public async Task InitializeAsync()
    {
        await database.StartAsync();
        Factory.ConnectionString = database.GetConnectionString();
        await using var scope = Factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        await database.DisposeAsync();
    }
}
