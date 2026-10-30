using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class LegacyCaptureUpgradeTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private readonly ApiFactory factory = new();
    private static readonly Guid Owner = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Chain = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid Location = Guid.Parse("00000000-0000-0000-0000-000000000003");
    private static readonly Guid Room = Guid.Parse("00000000-0000-0000-0000-000000000004");
    private static readonly Guid Meter = Guid.Parse("00000000-0000-0000-0000-000000000005");
    private static readonly Guid Resident = Guid.Parse("00000000-0000-0000-0000-000000000006");
    private static readonly Guid Task = Guid.Parse("00000000-0000-0000-0000-000000000007");
    private static readonly Guid Evidence = Guid.Parse("00000000-0000-0000-0000-000000000008");
    private static readonly Guid Reading = Guid.Parse("00000000-0000-0000-0000-000000000009");

    public async Task InitializeAsync()
    {
        await database.StartAsync();
        factory.ConnectionString = database.GetConnectionString();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await db.GetService<IMigrator>().MigrateAsync("20261028051723_AuthenticationSessions");
        var generator = db.GetService<IMigrationsSqlGenerator>();
        foreach (var command in generator.Generate(new LegacyCaptureWorkflowsFixture().UpOperations))
            await db.Database.ExecuteSqlRawAsync(command.CommandText);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO "__EFMigrationsHistory" VALUES ('20261028103339_CaptureWorkflows', '8.0.32');
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "AspNetUsers" ("Id", "UserName", "PasswordHash", "SecurityStamp", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount", "ManagingOwnerId")
            VALUES ({Owner}, 'synthetic-legacy', 'synthetic-unchanged-password-hash', 'synthetic-stamp', false, false, false, true, 0, {Owner});
            INSERT INTO "Chains" ("Id", "OwnerUserId", "Name", "CreatedAt", "UpdatedAt")
            VALUES ({Chain}, {Owner}, 'Synthetic legacy Chain', now(), now());
            INSERT INTO "Locations" ("Id", "ChainId", "Name", "Address", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES ({Location}, {Chain}, 'Synthetic legacy Location', 'Synthetic address', true, now(), now());
            INSERT INTO "Rooms" ("Id", "LocationId", "RoomNumber", "CreatedAt", "UpdatedAt") VALUES ({Room}, {Location}, 'SYNTHETIC-101', now(), now());
            INSERT INTO "SecurityAudit" ("Id", "UserId", "Event", "Succeeded", "OccurredAt", "TargetType", "TargetId")
            VALUES (gen_random_uuid(), {Owner}, 'SyntheticLegacyEvidence', true, now(), 'Room', {Room});
            """);
        const string identity = "{\"ciphertext\":\"synthetic-preserved-opaque-value\"}";
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Meters" ("Id","RoomId","Code","UtilityType","Display","DecimalPlaces","IsActive","InstalledOn","CreatedAt","UpdatedAt")
            VALUES ({Meter},{Room},'SYNTHETIC-METER',0,0,0,true,DATE '2026-10-01',now(),now());
            INSERT INTO "Residents" ("Id","RoomId","DisplayLabel","ResidentType","VerificationStatus","OwnerUserId","IdentityData","CreatedAt","UpdatedAt")
            VALUES ({Resident},{Room},'Synthetic resident',0,0,{Owner},{identity}::jsonb,now(),now());
            INSERT INTO "OperationalTasks" ("Id","MeterId","AssignedStaffUserId","Purpose","ReadingDate","Status","CreatedAt","UpdatedAt")
            VALUES ({Task},{Meter},{Owner},0,DATE '2026-10-01',2,now(),now());
            INSERT INTO "MeterEvidence" ("Id","TaskId","UploadedByUserId","ObjectKey","ImageHash","ContentType","Length","CleanupAfter","IsUploaded","IsLinked","CreatedAt","UpdatedAt")
            VALUES ({Evidence},{Task},{Owner},'synthetic-private-object','synthetic-hash','image/jpeg',100,now()+interval '1 day',true,true,now(),now());
            INSERT INTO "MeterReadings" ("Id","TaskId","MeterId","EvidenceId","ConfirmedValue","Status","ConfirmedByUserId","ConfirmedAt","CreatedAt","UpdatedAt")
            VALUES ({Reading},{Task},{Meter},{Evidence},42,0,{Owner},now(),now(),now());
            """);
    }

    [Fact]
    public async Task UpgradePreservesIdentityRoomsAuditAndHistoryAndIsRepeatable()
    {
        using var client = factory.CreateClient();
        Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await db.Database.MigrateAsync();
            await transaction.CommitAsync();
        }
        await db.Database.MigrateAsync();
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == Owner);
        Assert.Equal("synthetic-unchanged-password-hash", user.PasswordHash);
        Assert.Equal("synthetic-stamp", user.SecurityStamp);
        Assert.Equal(Owner, await db.Database.SqlQuery<Guid>($"""SELECT "LegacyManagedByOwnerUserId" AS "Value" FROM "AspNetUsers" WHERE "Id"={Owner}""").SingleAsync());
        Assert.Equal(Room, await db.Database.SqlQuery<Guid>($"""SELECT "Id" AS "Value" FROM "Rooms" """).SingleAsync());
        Assert.Equal(3, await db.Database.SqlQuery<int>($"""SELECT "Status" AS "Value" FROM "Rooms" """).SingleAsync());
        Assert.Equal(Chain, await db.Database.SqlQuery<Guid>($"""SELECT "Id" AS "Value" FROM "Chains" """).SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM "SecurityAudit" WHERE "Event"='SyntheticLegacyEvidence' AND "TargetType"='Room'""").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM legacy_capture_20261028."Rooms" """).SingleAsync());
        Assert.Equal("synthetic-preserved-opaque-value", await db.Database.SqlQuery<string>($"""SELECT "IdentityData"->>'ciphertext' AS "Value" FROM "Residents" WHERE "Id"={Resident}""").SingleAsync());
        Assert.Equal("synthetic-private-object", await db.Database.SqlQuery<string>($"""SELECT "ObjectKey" AS "Value" FROM "MeterEvidence" WHERE "Id"={Evidence}""").SingleAsync());
        Assert.Equal(42m, await db.Database.SqlQuery<decimal>($"""SELECT "ConfirmedValue" AS "Value" FROM "MeterReadings" WHERE "Id"={Reading}""").SingleAsync());
        Assert.Contains("20261028103339_CaptureWorkflows", await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.True((await client.GetAsync("/health/ready")).IsSuccessStatusCode);
        Assert.Empty(await db.Database.SqlQuery<Guid>($"""SELECT "Id" AS "Value" FROM "Contracts" """).ToArrayAsync());
        await using (var rollback = await db.Database.BeginTransactionAsync())
        {
            await Assert.ThrowsAsync<PostgresException>(() => db.GetService<IMigrator>().MigrateAsync("20261029154537_PropertyConfiguration"));
            await rollback.RollbackAsync();
        }
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.True(await db.Database.SqlQuery<bool>($"""SELECT to_regclass('public."Contracts"') IS NOT NULL AS "Value" """).SingleAsync());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ConflictingLegacyDataStopsWithoutMovingTablesOrInventingAssignmentActors(bool extraChain)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        if (extraChain)
            await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "Chains" ("Id", "OwnerUserId", "Name", "CreatedAt", "UpdatedAt") VALUES ({Guid.NewGuid()}, {Owner}, 'Synthetic second Chain', now(), now())""");
        else
            await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "StaffLocationAssignments" ("Id", "StaffUserId", "LocationId", "EffectiveFrom", "EffectiveTo", "CreatedAt", "UpdatedAt") VALUES ({Guid.NewGuid()}, {Owner}, {Location}, DATE '2026-10-01', NULL, now(), now())""");
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await Assert.ThrowsAsync<PostgresException>(() => db.Database.MigrateAsync());
            await transaction.RollbackAsync();
        }
        Assert.Equal(Room, await db.Database.SqlQuery<Guid>($"""SELECT "Id" AS "Value" FROM "Rooms" """).SingleAsync());
        Assert.False(await db.Database.SqlQuery<bool>($"""SELECT to_regnamespace('legacy_capture_20261028') IS NOT NULL AS "Value" """).SingleAsync());
        Assert.Equal(3, (await db.Database.GetAppliedMigrationsAsync()).Count());
    }

    [Fact]
    public async Task AFailureAfterArchivingRollsBackAllPendingMigrationsAndOriginalData()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        // A real downstream DDL conflict, beyond the archive preconditions.
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE \"RoomTypes\" (\"Id\" uuid PRIMARY KEY)");
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await Assert.ThrowsAsync<PostgresException>(() => db.Database.MigrateAsync());
            await transaction.RollbackAsync();
        }
        Assert.Equal(Room, await db.Database.SqlQuery<Guid>($"""SELECT "Id" AS "Value" FROM "Rooms" """).SingleAsync());
        Assert.False(await db.Database.SqlQuery<bool>($"""SELECT to_regnamespace('legacy_capture_20261028') IS NOT NULL AS "Value" """).SingleAsync());
        Assert.Equal(3, (await db.Database.GetAppliedMigrationsAsync()).Count());
    }

    public async Task DisposeAsync() { await factory.DisposeAsync(); await database.DisposeAsync(); }
}
