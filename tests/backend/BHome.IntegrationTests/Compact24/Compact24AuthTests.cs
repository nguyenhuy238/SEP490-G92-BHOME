using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class CompactPostgresFactAttribute : FactAttribute
{
    public CompactPostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")))
            Skip = "Set BHOME_COMPACT24_TEST_ADMIN to an authorized loopback PostgreSQL admin for disposable databases.";
    }
}

[Trait("Category", "CompactPostgres")]
public sealed class Compact24AuthTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!Password-493";
    private const string NewPassword = "Synthetic!Password-927";

    [CompactPostgresFact]
    public async Task SameApiAndIdentityHashWorkWithoutAnyLegacyContextOrTable()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        var session = await Login(client, user.Email!);
        Assert.Equal(user.Id, session.UserId);
        Assert.Equal(new[] { "Tenant" }, session.Roles);
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/session")).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        Assert.Null(scope.ServiceProvider.GetService<BHomeDbContext>());
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var persisted = await db.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id);
        Assert.Equal(user.PasswordHash, persisted.PasswordHash);
        Assert.Equal(new[] { "refresh_tokens", "users" }, db.Model.GetRelationalModel().Tables.Select(x => x.Name).Order().ToArray());
        await using var connection = new NpgsqlConnection(fixture.Connection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", connection);
        Assert.Equal(24L, await command.ExecuteScalarAsync());
    }

    [CompactPostgresFact]
    public async Task UpdatedProfilePhoneCanSignInAndRevokesThePreviousSession()
    {
        var user = await Seed(); using var client = fixture.Factory!.CreateClient();
        var session = await Login(client, user.Email!); Bearer(client, session);
        var profile = (await client.GetFromJsonAsync<BHome.Application.Operations.ProfileView>("/api/v1/account/profile"))!;
        var updated = await client.PutAsJsonAsync("/api/v1/account/profile", new
        {
            fullName = "Synthetic Tenant",
            phone = "090-123 4567",
            email = user.Email,
            version = profile.Version
        });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);

        client.DefaultRequestHeaders.Authorization = null;
        var byPhone = await client.PostAsJsonAsync("/api/v1/auth/login", new { phone = "090 123 4567", password = Password });
        Assert.Equal(HttpStatusCode.OK, byPhone.StatusCode);
        Assert.Equal(user.Id, (await TestAuthResponse.ReadAsync(byPhone.Content)).UserId);
    }

    [CompactPostgresFact]
    public async Task RotationRejectsReplayAndRevokesFamilyIncludingNewAccessToken()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        var first = await Login(client, user.Email!);
        var rotated = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { first.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var second = await TestAuthResponse.ReadAsync(rotated.Content);
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        Assert.Equal(first.SessionId, second.SessionId);
        var replay = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { first.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Bearer(client, second);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task ParallelRefreshCannotIssueTwoUsableSessions()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        var first = await Login(client, user.Email!);
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => client.PostAsJsonAsync("/api/v1/auth/refresh", new { first.RefreshToken })));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Unauthorized);
        var winner = await TestAuthResponse.ReadAsync(responses.Single(r => r.StatusCode == HttpStatusCode.OK).Content);
        Bearer(client, winner);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task LogoutAllAndPasswordChangeKeepExistingHttpContracts()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        var first = await Login(client, user.Email!);
        var other = await Login(client, user.Email!);
        Bearer(client, first);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/logout-all", new { })).StatusCode);
        Bearer(client, other);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        var current = await Login(client, user.Email!);
        Bearer(client, current);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = Password, newPassword = NewPassword })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = NewPassword })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task LockoutInactiveTwoFactorAndExpiredSessionFailClosed()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "Wrong!Password-493" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password })).StatusCode);
        foreach (var state in new[] { "inactive", "twofactor", "expired" })
        {
            var other = await Seed();
            var session = await Login(client, other.Email!);
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            if (state == "inactive") await db.Users.Where(x => x.Id == other.Id).ExecuteUpdateAsync(u => u.SetProperty(x => x.IsActive, false));
            if (state == "twofactor") await db.Users.Where(x => x.Id == other.Id).ExecuteUpdateAsync(u => u.SetProperty(x => x.TwoFactorEnabled, true));
            if (state == "expired") await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refresh_tokens SET issued_at={DateTimeOffset.UtcNow.AddDays(-10)},expires_at={DateTimeOffset.UtcNow.AddDays(-1)} WHERE id={session.SessionId}");
            Bearer(client, session);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
        }
    }

    [CompactPostgresFact]
    public async Task RoleAndAccountChangesThroughStoreCannotResurrectOldSessions()
    {
        var user = await Seed();
        using var client = fixture.Factory!.CreateClient();
        var session = await Login(client, user.Email!);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var stored = (await users.FindByIdAsync(user.Id.ToString()))!;
            Assert.True((await users.AddToRoleAsync(stored, "Staff")).Succeeded);
            Assert.True((await users.RemoveFromRoleAsync(stored, "Staff")).Succeeded);
            stored.IsActive = false; Assert.True((await users.UpdateAsync(stored)).Succeeded);
            stored.IsActive = true; Assert.True((await users.UpdateAsync(stored)).Succeeded);
        }
        Bearer(client, session);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task AdministrativeAccountAndRoleUpdatesCannotResurrectSessions()
    {
        var user = await Seed(); using var client = fixture.Factory!.CreateClient();
        var session = await Login(client, user.Email!);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=false WHERE id={user.Id}");
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=true WHERE id={user.Id}");
        }
        Bearer(client, session); Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task ResetGrantIsOneTimeAndAuditNeverAppearsAsInbox()
    {
        var delivery = new ResetDelivery();
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<IPasswordResetDelivery>(delivery)));
        using var client = host.CreateClient();
        var user = await Seed();
        var first = await Login(client, user.Email!);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.UserName })).StatusCode);
        Assert.NotNull(delivery.Token);
        var reset = new { userName = user.UserName, token = delivery.Token, newPassword = NewPassword };
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Bearer(client, first);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/session")).StatusCode);
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM notifications WHERE record_kind='AUDIT' AND related_entity_id=@id AND recipient_user_id IS NULL", connection);
        command.Parameters.AddWithValue("id", user.Id);
        Assert.True((long)(await command.ExecuteScalarAsync())! > 0);
    }

    [CompactPostgresFact]
    public async Task OptimisticConcurrencyAndMissingRoleAreRejectedWithoutDefaultRole()
    {
        var user = await Seed();
        await using var left = fixture.Factory!.Services.CreateAsyncScope();
        await using var right = fixture.Factory.Services.CreateAsyncScope();
        var manager1 = left.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var manager2 = right.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var first = (await manager1.FindByIdAsync(user.Id.ToString()))!;
        var stale = (await manager2.FindByIdAsync(user.Id.ToString()))!;
        first.PhoneNumber = "SYNTHETIC"; Assert.True((await manager1.UpdateAsync(first)).Succeeded);
        stale.PhoneNumber = "STALE"; Assert.False((await manager2.UpdateAsync(stale)).Succeeded);
        var blank = new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid():N}@example.invalid" };
        var result = await manager1.CreateAsync(blank, Password);
        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, x => x.Code == "CompactRoleRequired");
    }

    private async Task<ApplicationUser> Seed()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser
        {
            Id = id,
            UserName = id.ToString(),
            NormalizedUserName = id.ToString().ToUpperInvariant(),
            Email = $"{id:N}@example.invalid",
            NormalizedEmail = $"{id:N}@EXAMPLE.INVALID".ToUpperInvariant(),
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
            LockoutEnabled = true
        };
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ApplicationUser>>().HashPassword(user, Password);
        db.Users.Add(user); db.Entry(user).Property("roles").CurrentValue = new[] { "Tenant" };
        await db.SaveChangesAsync();
        return user;
    }
    private static async Task<LoginResult> Login(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await TestAuthResponse.ReadAsync(response.Content);
    }
    private static void Bearer(HttpClient client, LoginResult session) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
    private sealed class ResetDelivery : IPasswordResetDelivery
    {
        public string? Token { get; private set; }
        public bool IsAvailable => true;
        public Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken) { Token = token; return Task.CompletedTask; }
    }
}

public sealed class Compact24Fixture : IAsyncLifetime
{
    private readonly bool keepHostedServices;
    public Compact24Fixture() { }
    internal Compact24Fixture(bool keepHostedServices) => this.keepHostedServices = keepHostedServices;
    private string? admin;
    private string? name;
    private ApiFactory? baseFactory;
    public string Connection { get; private set; } = "";
    public WebApplicationFactory<Program>? Factory { get; private set; }
    public async Task InitializeAsync()
    {
        admin = Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN");
        if (string.IsNullOrWhiteSpace(admin)) return;
        var settings = new NpgsqlConnectionStringBuilder(admin);
        if (settings.Host is not ("127.0.0.1" or "localhost" or "::1") || settings.Database != "postgres")
            throw new InvalidOperationException("Compact tests require an explicitly authorized loopback admin database.");
        name = "bhome_compact24_" + Guid.NewGuid().ToString("N");
        await using (var connection = new NpgsqlConnection(admin))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
            await command.ExecuteNonQueryAsync();
        }
        settings.Database = name; Connection = settings.ConnectionString;
        await using (var connection = new NpgsqlConnection(Connection))
        {
            await connection.OpenAsync();
            await using var stream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
            using var reader = new StreamReader(stream);
            await using var command = new NpgsqlCommand(await reader.ReadToEndAsync(), connection);
            await command.ExecuteNonQueryAsync();
        }
        baseFactory = new ApiFactory { ConnectionString = Connection, UseCompact24 = true };
        Factory = baseFactory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            // No legacy workers or DbContext may execute in this isolated slice test host.
            if (!keepHostedServices) services.RemoveAll<IHostedService>();
        }));
    }
    public async Task DisposeAsync()
    {
        try { if (Factory is not null) await Factory.DisposeAsync(); if (baseFactory is not null) await baseFactory.DisposeAsync(); }
        finally
        {
            if (admin is not null && name is not null && System.Text.RegularExpressions.Regex.IsMatch(name, "^bhome_compact24_[a-f0-9]{32}$"))
            {
                await using var connection = new NpgsqlConnection(admin); await connection.OpenAsync();
                await using var command = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection);
                await command.ExecuteNonQueryAsync();
            }
        }
    }
}
