using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.Infrastructure.UnitTests.AccountProvisioning;

// One disposable PostgreSQL container for the whole sheet; every test gets its own fresh database.
public sealed class PostgresContainerFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:16-alpine").Build();
    public string AdminConnection => container.GetConnectionString();
    public Task InitializeAsync() => container.StartAsync();
    public Task DisposeAsync() => container.DisposeAsync().AsTask();
}

[CollectionDefinition(Name)]
public sealed class AccountProvisioningCollection : ICollectionFixture<PostgresContainerFixture>
{
    public const string Name = "AccountProvisioning";
}

// Unit-test world for sheet "AccountProvisioning": the real function under test with its real
// persistence (isolated Compact24 database), and fakes only for the outside world
// (signed-in user, clock, invitation e-mail delivery).
internal sealed class AccountProvisioningWorld : IAsyncDisposable
{
    public static readonly Guid OwnerId = Guid.Parse("c2400000-0000-4000-8000-000000000001");
    public static readonly Guid StaffSampleId = Guid.Parse("c2400000-0000-4000-8000-000000000002");
    public static readonly Guid TenantSampleId = Guid.Parse("c2400000-0000-4000-8000-000000000003");
    public static readonly Guid Staff1Id = Guid.Parse("9d0b82a6-c6c4-4ffc-aa88-8c56925ddf09");
    public static readonly Guid StaffApiTestId = Guid.Parse("46d37209-89cd-4bd4-81f5-fa0fdc8adb0d");

    private ServiceProvider? root;
    private AsyncServiceScope scope;
    public FakeCurrentUser CurrentUser { get; } = new();
    public FakeEmailDelivery Email { get; } = new();
    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 11, 13, 3, 0, 0, TimeSpan.Zero));
    public string Connection { get; private set; } = "";

    public static async Task<AccountProvisioningWorld> CreateAsync(PostgresContainerFixture postgres)
    {
        var world = new AccountProvisioningWorld();
        var settings = new NpgsqlConnectionStringBuilder(postgres.AdminConnection);
        var name = "bhome_ut_" + Guid.NewGuid().ToString("N");
        await using (var admin = new NpgsqlConnection(settings.ConnectionString))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", admin);
            await create.ExecuteNonQueryAsync();
        }
        settings.Database = name;
        world.Connection = settings.ConnectionString;
        await using (var connection = new NpgsqlConnection(world.Connection))
        {
            await connection.OpenAsync();
            await using var stream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
            using var reader = new StreamReader(stream);
            await using var schema = new NpgsqlCommand(await reader.ReadToEndAsync(), connection);
            await schema.ExecuteNonQueryAsync();
        }
        world.Build();
        return world;
    }

    private void Build()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = Connection,
            ["Jwt:SigningKey"] = "unit-test-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz",
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddInfrastructure(config);
        services.RemoveAll<IHostedService>();
        services.RemoveAll<ICurrentUser>();
        services.AddSingleton<ICurrentUser>(CurrentUser);
        services.RemoveAll<IPasswordResetDelivery>();
        services.AddSingleton<IPasswordResetDelivery>(Email);
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(Clock);
        root = services.BuildServiceProvider();
        scope = root.CreateAsyncScope();
    }

    public T Get<T>() where T : notnull => scope.ServiceProvider.GetRequiredService<T>();
    public Compact24DbContext Db => Get<Compact24DbContext>();

    // A fresh scope = a fresh DbContext, so assertions read what was really committed.
    public async Task<TResult> ReadAsync<TResult>(Func<Compact24DbContext, Task<TResult>> read)
    {
        await using var fresh = root!.CreateAsyncScope();
        return await read(fresh.ServiceProvider.GetRequiredService<Compact24DbContext>());
    }

    public void SignInAsOwner() => CurrentUser.Set(OwnerId, Roles.Owner);

    // Raw SQL is used only to arrange preconditions and read committed results.
    public async Task ExecAsync(string sql, params (string Name, object? Value)[] args)
    {
        await using var connection = new NpgsqlConnection(Connection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (n, v) in args) command.Parameters.AddWithValue(n, v ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<T> ScalarAsync<T>(string sql, params (string Name, object? Value)[] args)
    {
        await using var connection = new NpgsqlConnection(Connection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (n, v) in args) command.Parameters.AddWithValue(n, v ?? DBNull.Value);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    // Log Message column: audit events are stored as AUDIT records.
    public Task<long> AuditCountAsync(string eventName) => ScalarAsync<long>(
        "select count(*) from notifications where record_kind = 'AUDIT' and notification_type = @e", ("e", eventName));

    public Task<long> UserCountAsync(string email) => ScalarAsync<long>(
        "select count(*) from users where normalized_email = upper(@e)", ("e", email));

    // Precondition helper: an account stored the way the system stores it (UserManager + role).
    public async Task<ApplicationUser> AddUserAsync(Guid id, string email, string role, string password,
        string? phone = null, bool active = true, bool emailConfirmed = true)
    {
        await using var setup = root!.CreateAsyncScope();
        var db = setup.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var user = new ApplicationUser
        {
            Id = id, UserName = email, Email = email, PhoneNumber = phone,
            IsActive = active, EmailConfirmed = emailConfirmed, LockoutEnabled = true,
        };
        db.PrepareUserRole(user, role);
        var result = await setup.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().CreateAsync(user, password);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Code)));
        return user;
    }

    public async ValueTask DisposeAsync()
    {
        await scope.DisposeAsync();
        if (root is not null) await root.DisposeAsync();
    }
}

internal sealed class FakeCurrentUser : ICurrentUser
{
    private string[] roles = [];
    public Guid? UserId { get; private set; }
    public void Set(Guid? userId, params string[] userRoles) => (UserId, roles) = (userId, userRoles);
    public bool IsInRole(string role) => roles.Contains(role);
}

internal sealed class FakeEmailDelivery : IPasswordResetDelivery
{
    public bool IsAvailable { get; set; } = true;
    public List<(Guid UserId, string Destination, string Token)> Sent { get; } = [];
    public Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken)
    {
        Sent.Add((userId, destination, token));
        return Task.CompletedTask;
    }
}
