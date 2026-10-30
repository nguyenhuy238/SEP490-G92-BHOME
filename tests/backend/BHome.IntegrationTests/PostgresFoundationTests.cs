using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class PostgresFoundationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private readonly ApiFactory factory = new();

    [Fact]
    public async Task SessionMigrationPreservesLegacyAccountAndCanDowngradeOnlyItsAdditions()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var migrator = db.GetService<IMigrator>();
        const string initial = "20261022164301_InitialFoundation";
        await migrator.MigrateAsync(initial);
        var id = Guid.NewGuid();
        var name = id.ToString();
        const string syntheticHash = "synthetic-existing-hash-preservation-only";
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "AspNetUsers" ("Id", "UserName", "PasswordHash", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES ({id}, {name}, {syntheticHash}, false, false, false, true, 0)
            """);
        await migrator.MigrateAsync();
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == id);
        Assert.True(user.IsActive);
        Assert.Equal(syntheticHash, user.PasswordHash);
        Assert.Empty(await db.AuthenticationSessions.ToArrayAsync());
        await migrator.MigrateAsync(initial);
        var preserved = await db.Database.SqlQuery<string>($"""
            SELECT "PasswordHash" AS "Value" FROM "AspNetUsers" WHERE "Id" = {id}
            """).SingleAsync();
        Assert.Equal(syntheticHash, preserved);
    }

    public async Task InitializeAsync()
    {
        await database.StartAsync();
        factory.ConnectionString = database.GetConnectionString();
    }

    [Fact]
    public async Task ApiReadinessRequiresAppliedMigrations()
    {
        using var client = factory.CreateClient();
        Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
        Assert.True((await client.GetAsync("/health/ready")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task ContractMigrationPreservesRoomStatusesAcrossUpgradeDowngradeAndRetry()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var migrator = db.GetService<IMigrator>();
        const string property = "20261029154537_PropertyConfiguration";
        const string contract = "20261029170352_ContractActivationLifecycle";
        await migrator.MigrateAsync(property);
        var locationId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Locations" ("Id", "Name", "Address", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES ({locationId}, 'Synthetic migration location', '', true, now(), now());
            INSERT INTO "Rooms" ("Id", "LocationId", "RoomNumber", "Status", "CreatedAt", "UpdatedAt")
            SELECT gen_random_uuid(), {locationId}, 'SYNTHETIC-' || value, value, now(), now()
            FROM generate_series(0, 3) AS value;
            """);

        async Task AssertRoomStatuses()
        {
            var statuses = await db.Database.SqlQuery<int>($"""
                SELECT "Status" AS "Value" FROM "Rooms" WHERE "LocationId" = {locationId} ORDER BY "Status"
                """).ToArrayAsync();
            Assert.Equal(new[] { 0, 1, 2, 3 }, statuses);
        }

        await migrator.MigrateAsync(contract);
        await AssertRoomStatuses();
        Assert.Equal(0, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "Contracts"
            """).SingleAsync());

        await migrator.MigrateAsync(property);
        await AssertRoomStatuses();
        Assert.False(await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'Contracts') AS "Value"
            """).SingleAsync());

        await migrator.MigrateAsync();
        await migrator.MigrateAsync();
        await AssertRoomStatuses();
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.False(db.Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task RepeatedEnqueueCreatesOneDurableJob()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
        var queue = scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>();
        var job = new JobSubmission("test", Guid.NewGuid().ToString(), "{}");
        await queue.EnqueueAsync(job, default);
        await queue.EnqueueAsync(job, default);
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var count = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "BackgroundJobs" WHERE "Name" = {job.Name} AND "IdempotencyKey" = {job.IdempotencyKey}
            """).SingleAsync();
        Assert.Equal(1, count);
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        await database.DisposeAsync();
    }
}
