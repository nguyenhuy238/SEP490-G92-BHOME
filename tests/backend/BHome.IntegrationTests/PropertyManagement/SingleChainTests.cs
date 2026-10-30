using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.PropertyManagement;

[Trait("Category", "Docker")]
public sealed class SingleChainTests(AuthenticationDatabaseFixture fixture) : IClassFixture<AuthenticationDatabaseFixture>
{
    private async Task<HttpClient> Client(string role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var account = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid" };
        const string password = "Synthetic-SingleChain!493";
        Assert.True((await users.CreateAsync(account, password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(account, role)).Succeeded);
        var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { account.Email, password });
        response.EnsureSuccessStatusCode();
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return client;
    }

    [Fact]
    public async Task OwnerRenamesExistingChainAndLocationsIgnoreCallerSelectedChain()
    {
        using var owner = await Client(Roles.Owner);
        var chain = (await owner.GetFromJsonAsync<ChainDto>("/api/v1/chain"))!;
        var reason = "Owner configuration " + Guid.NewGuid().ToString("N");
        var renamed = await owner.PutAsJsonAsync("/api/v1/chain", new ChainWrite(" Synthetic renamed Chain ", chain.Version, reason));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var changed = (await renamed.Content.ReadFromJsonAsync<ChainDto>())!;
        Assert.Equal(chain.Id, changed.Id); Assert.Equal("Synthetic renamed Chain", changed.Name);
        Assert.Equal(chain.Version + 1, changed.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/v1/chain", new ChainWrite("Stale", chain.Version))).StatusCode);
        foreach (var name in new[] { "", "   ", new string('x', 151) })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/chain", new ChainWrite(name, changed.Version))).StatusCode);
        var created = await owner.PostAsJsonAsync("/api/v1/locations", new { name = "Automatic chain", address = "Synthetic address", chainId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(chain.Id, (await created.Content.ReadFromJsonAsync<LocationDto>())!.ChainId);
        var capture = await owner.PostAsJsonAsync("/api/v1/capture/locations", new { name = "Capture automatic chain", address = "Synthetic address" });
        Assert.Equal(HttpStatusCode.OK, capture.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await owner.PostAsJsonAsync("/api/v1/capture/chains", new { name = "Forbidden extra Chain" })).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<Chain>().CountAsync());
        var audit = await db.Set<PropertyChange>().SingleAsync(x => x.TargetId == chain.Id && x.Action == "Renamed" && x.Reason == reason);
        Assert.Null(audit.LocationId); Assert.Contains("Synthetic renamed Chain", audit.After);
    }

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task OnlyOwnerCanReadOrRenameChainSettings(string role)
    {
        using var client = await Client(role);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/chain")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/api/v1/chain", new ChainWrite("Denied", 1))).StatusCode);
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/chain")).StatusCode);
    }

    [Fact]
    public async Task ParallelRenamesHaveOneWinnerAndDatabaseRejectsExtraOrDeletedChain()
    {
        using var owner = await Client(Roles.Owner);
        var chain = (await owner.GetFromJsonAsync<ChainDto>("/api/v1/chain"))!;
        var edits = await Task.WhenAll(new[] { "Name A", "Name B" }.Select(name => owner.PutAsJsonAsync("/api/v1/chain", new ChainWrite(name, chain.Version))));
        Assert.Single(edits, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(edits, x => x.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        db.Set<Chain>().Add(new Chain { Name = "Second Chain" });
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23505", Assert.IsType<PostgresException>(duplicate.InnerException).SqlState);
        db.ChangeTracker.Clear();
        foreach (var sql in new[] { "DELETE FROM \"Chains\"", "TRUNCATE \"Chains\" CASCADE" })
        {
            var denied = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql));
            Assert.Equal("23514", denied.SqlState);
        }
        Assert.Equal(chain.Id, (await db.Set<Chain>().SingleAsync()).Id);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public async Task MigrationSeedsOrPreservesSingleChainAndStopsInsteadOfMergingMultiple(int chainCount)
    {
        var admin = new NpgsqlConnectionStringBuilder(fixture.Factory.ConnectionString) { Database = "postgres" };
        var name = "bhome_chain_migration_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(admin.ConnectionString); await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection)) await create.ExecuteNonQueryAsync();
        try
        {
            admin.Database = name;
            await using var db = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(admin.ConnectionString).Options);
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261029154537_PropertyConfiguration");
            var existing = Guid.NewGuid(); var location = Guid.NewGuid();
            for (var i = 0; i < chainCount; i++)
            {
                var id = i == 0 ? existing : Guid.NewGuid();
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Chains\" (\"Id\",\"Name\",\"CreatedAt\",\"UpdatedAt\") VALUES ({id}, 'Existing Chain', now(), now())");
            }
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Locations\" (\"Id\",\"Name\",\"Address\",\"IsActive\",\"CreatedAt\",\"UpdatedAt\",\"Version\") VALUES ({location}, 'Legacy Location', '', false, now(), now(), 1)");
            if (chainCount > 1)
            {
                var error = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync());
                Assert.Equal("P0001", error.SqlState);
                Assert.Equal(2, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM \"Chains\"").SingleAsync());
            }
            else
            {
                await migrator.MigrateAsync();
                var chain = await db.Set<Chain>().SingleAsync();
                Assert.Equal(chainCount == 0 ? "BHOME" : "Existing Chain", chain.Name);
                if (chainCount == 1) Assert.Equal(existing, chain.Id);
                Assert.Equal(chain.Id, (await db.Locations.SingleAsync()).ChainId);
                Assert.Equal(1, chain.Version);
                await migrator.MigrateAsync("20261029154537_PropertyConfiguration");
                Assert.Equal(chain.Id, await db.Database.SqlQuery<Guid>($"SELECT \"Id\" AS \"Value\" FROM \"Chains\"").SingleAsync());
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection); await drop.ExecuteNonQueryAsync();
        }
    }
}
