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
using Npgsql;

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
            email = user.Email,
            password = TestPassword,
            roles = new[] { Roles.Owner }
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var session = await response.Content.ReadFromJsonAsync<LoginResult>();
        Assert.NotNull(session);
        Assert.Equal(user.Id, session.UserId);
        Assert.Equal([role], session.Roles);
        Assert.InRange(session.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(29), DateTimeOffset.UtcNow.AddMinutes(30));

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
            email = scenario == "unknown" ? $"{Guid.NewGuid():N}@example.invalid" : user.Email,
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
            var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        var correctPassword = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = TestPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, correctPassword.StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var stored = await users.FindByIdAsync(user.Id.ToString());
        Assert.NotNull(stored);
        Assert.True(await users.IsLockedOutAsync(stored));
    }

    [Fact]
    public async Task EmailLookupUsesIdentityNormalizationAndNeverFallsBackToUserName()
    {
        var user = await CreateUserAsync(Roles.Staff);
        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = user.Email!.ToUpperInvariant(), password = TestPassword });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(user.Id, (await response.Content.ReadFromJsonAsync<LoginResult>())!.UserId);

        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var misleadingName = $"{Guid.NewGuid():N}@example.invalid";
        var stored = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.True((await users.SetUserNameAsync(stored, misleadingName)).Succeeded);
        var rejected = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = misleadingName, password = TestPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
    }

    [Fact]
    public async Task DuplicateLegacyNormalizedEmailsAreDeniedWithoutIssuingASession()
    {
        var first = await CreateUserAsync(Roles.Owner);
        var second = await CreateUserAsync(Roles.Staff);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var user = (await db.Users.FindAsync(second.Id))!;
        user.Email = first.Email;
        user.NormalizedEmail = first.Email!.ToUpperInvariant();
        await db.SaveChangesAsync();
        using var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = first.Email, password = TestPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.False(await db.AuthenticationSessions.AnyAsync(x => x.UserId == first.Id || x.UserId == second.Id));
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
    private PostgreSqlContainer? database;
    private string? nativeAdmin;
    private string? nativeDatabase;
    public ApiFactory Factory { get; } = new();

    public async Task InitializeAsync()
    {
        // Opt in only for a dedicated temporary local cluster, never the developer's bhome database.
        var native = Environment.GetEnvironmentVariable("BHOME_AUTH_TEST_POSTGRES_ADMIN");
        if (string.IsNullOrWhiteSpace(native))
        {
            database = new PostgreSqlBuilder("postgres:16-alpine").Build();
            await database.StartAsync();
            Factory.ConnectionString = database.GetConnectionString();
        }
        else
        {
            var settings = new NpgsqlConnectionStringBuilder(native);
            if (settings.Host != "127.0.0.1" || settings.Port == 5432 || settings.Database != "postgres" ||
                settings.Username != "bhome_test_runner")
                throw new InvalidOperationException("Native auth tests require a dedicated loopback test cluster and test runner role.");
            nativeAdmin = native;
            nativeDatabase = "bhome_auth_test_" + Guid.NewGuid().ToString("N");
            await using var connection = new NpgsqlConnection(nativeAdmin);
            await connection.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{nativeDatabase}\"", connection);
            await create.ExecuteNonQueryAsync();
            settings.Database = nativeDatabase;
            Factory.ConnectionString = settings.ConnectionString;
        }
        await using var scope = Factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        try { await Factory.DisposeAsync(); }
        finally
        {
            if (database is not null) await database.DisposeAsync();
            if (nativeAdmin is not null && nativeDatabase is not null)
            {
                await using var connection = new NpgsqlConnection(nativeAdmin);
                await connection.OpenAsync();
                await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{nativeDatabase}\" WITH (FORCE)", connection);
                await drop.ExecuteNonQueryAsync();
            }
        }
    }
}
