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
    public async Task RetiredChainEndpointsAreUnavailable()
    {
        using var owner = await Client(Roles.Owner);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync("/api/v1/chain")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PutAsJsonAsync("/api/v1/chain", new { name = "Retired", version = 1 })).StatusCode);
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
