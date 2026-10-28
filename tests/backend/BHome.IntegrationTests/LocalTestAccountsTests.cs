using BHome.Infrastructure;
using BHome.Infrastructure.Persistence;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests;

public sealed class LocalTestAccountTargetTests
{
    [Theory]
    [InlineData("Production", "localhost", "bhome")]
    [InlineData("Development", "db.example.invalid", "bhome")]
    [InlineData("Development", "localhost,db.example.invalid", "bhome")]
    [InlineData("Development", "127.0.0.1", "another_database")]
    public void UnsafeTargetsAreRejectedBeforeDatabaseAccess(string environment, string host, string database) =>
        Assert.Throws<LocalTestAccountException>(() => LocalTestAccounts.ValidateTarget(environment,
            $"Host={host};Database={database};Username=synthetic"));
}

[Trait("Category", "Docker")]
public sealed class LocalTestAccountsTests : IAsyncLifetime
{
    private const string Password = "Synthetic-Only!Test-493";
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").WithDatabase("bhome").Build();
    private ServiceProvider provider = null!;

    public async Task InitializeAsync()
    {
        await database.StartAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = database.GetConnectionString()
        }).Build();
        var services = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(config);
        services.AddInfrastructure(config);
        provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }

    [Fact]
    public async Task CreatesThreeSyntheticAccountsWithRealIdentityHashingAndExactRoles()
    {
        Assert.True(await LocalTestAccounts.CreateAsync(provider, "Development", Password));
        await using var scope = provider.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        foreach (var role in new[] { "Owner", "Staff", "Tenant" })
        {
            var user = await users.FindByNameAsync(role.ToLowerInvariant() + ".dev");
            Assert.NotNull(user);
            Assert.Equal([role], await users.GetRolesAsync(user));
            Assert.True(await users.CheckPasswordAsync(user, Password));
            Assert.NotEqual(Password, user.PasswordHash);
        }
    }

    [Fact]
    public async Task ExistingNameDoesNotAcquireNewRolesOrPasswordAndNoOtherAccountsAreCreated()
    {
        await using var scope = provider.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var existing = new ApplicationUser { Id = Guid.NewGuid(), UserName = "owner.dev", Email = "collision@example.invalid" };
        Assert.True((await users.CreateAsync(existing, Password)).Succeeded);
        Assert.False(await LocalTestAccounts.CreateAsync(provider, "Development", "Different!Password-983"));
        Assert.Empty(await users.GetRolesAsync(existing));
        Assert.True(await users.CheckPasswordAsync(existing, Password));
        Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Users.CountAsync());
    }

    [Fact]
    public async Task InvalidPasswordLeavesNoPartiallyCreatedAccounts()
    {
        await Assert.ThrowsAsync<LocalTestAccountException>(() => LocalTestAccounts.CreateAsync(provider, "Development", "weak"));
        await using var scope = provider.CreateAsyncScope();
        Assert.Empty(await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Users.ToArrayAsync());
    }

    [Fact]
    public async Task EmailCollisionRollsBackEarlierAccountAndItsAudit()
    {
        await using var scope = provider.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        Assert.True((await users.CreateAsync(new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = "collision",
            Email = "staff.dev@example.invalid"
        }, Password)).Succeeded);
        await Assert.ThrowsAsync<LocalTestAccountException>(() => LocalTestAccounts.CreateAsync(provider, "Development", Password));
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.False(await db.Users.AnyAsync(x => x.UserName == "owner.dev"));
        Assert.Empty(await db.SecurityAudit.ToArrayAsync());
    }

    public async Task DisposeAsync()
    {
        await provider.DisposeAsync();
        await database.DisposeAsync();
    }
}
