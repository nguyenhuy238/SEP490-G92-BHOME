using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.StaffOperations;

[Trait("Category", "Docker")]
public sealed class OperationalTaskMigrationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    public Task InitializeAsync() => postgres.StartAsync();
    public async Task DisposeAsync() => await postgres.DisposeAsync();
    [Fact]
    public async Task UpgradeBackfillsLocationPreservesMeterReferencesAndRejectsLossyDowngrade()
    {
        await using var db = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(postgres.GetConnectionString()).Options);
        var migrator = db.GetService<IMigrator>();
        const string previous = "20261030032653_FlexibleFutureBillingPolicies";
        await migrator.MigrateAsync(previous);
        // Inspect the actual disposable database before changing its schema.
        var beforeColumns = await db.Database.SqlQuery<string>($"""
            SELECT column_name AS "Value" FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'OperationalTasks'
            """).ToArrayAsync();
        Assert.Contains("MeterId", beforeColumns); Assert.DoesNotContain("LocationId", beforeColumns);
        var location = Guid.NewGuid(); var room = Guid.NewGuid(); var meter = Guid.NewGuid(); var task = Guid.NewGuid();
        var evidence = Guid.NewGuid(); var user = Guid.NewGuid(); var reading = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "AspNetUsers" ("Id", "UserName", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount", "IsActive")
            VALUES ({user}, 'synthetic-migration-user', false, false, false, false, 0, true);
            INSERT INTO "Locations" ("Id", "ChainId", "Name", "Address", "IsActive", "Version", "CreatedAt", "UpdatedAt")
            VALUES ({location}, (SELECT "Id" FROM "Chains"), 'Synthetic task migration', '', true, 1, now(), now());
            INSERT INTO "Rooms" ("Id", "LocationId", "RoomNumber", "Capacity", "Status", "Version", "CreatedAt", "UpdatedAt")
            VALUES ({room}, {location}, 'SYNTHETIC', 1, 0, 1, now(), now());
            INSERT INTO "Meters" ("Id", "RoomId", "Code", "UtilityType", "Display", "DecimalPlaces", "IsActive", "InstalledOn", "CreatedAt", "UpdatedAt")
            VALUES ({meter}, {room}, 'SYNTHETIC', 0, 0, 0, true, DATE '2026-10-01', now(), now());
            INSERT INTO "OperationalTasks" ("Id", "MeterId", "Purpose", "ReadingDate", "Status", "OcrProposedValue", "CompletedAt", "CreatedAt", "UpdatedAt")
            VALUES ({task}, {meter}, 0, DATE '2026-10-01', 2, 100, now(), now(), now());
            INSERT INTO "MeterEvidence" ("Id", "TaskId", "UploadedByUserId", "ObjectKey", "ImageHash", "ContentType", "Length", "CleanupAfter", "IsUploaded", "IsLinked", "CreatedAt", "UpdatedAt")
            VALUES ({evidence}, {task}, {user}, 'synthetic-migration-only', 'synthetic', 'image/png', 1, now(), true, true, now(), now());
            INSERT INTO "MeterReadings" ("Id", "TaskId", "MeterId", "EvidenceId", "ConfirmedValue", "Status", "ConfirmedByUserId", "ConfirmedAt", "CreatedAt", "UpdatedAt")
            VALUES ({reading}, {task}, {meter}, {evidence}, 100, 0, {user}, now(), now(), now());
            """);
        await migrator.MigrateAsync();
        var migrated = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(x => x.Id == task);
        Assert.Equal(location, migrated.LocationId); Assert.Equal(1, migrated.Version);
        Assert.Equal(OperationalTaskKind.MeterReading, migrated.Kind);
        Assert.Equal(MeterTaskStatus.Completed, migrated.Status); Assert.Equal(100, migrated.OcrProposedValue);
        Assert.Null(migrated.AssignedStaffUserId);
        Assert.Equal(evidence, (await db.Set<MeterReading>().AsNoTracking().SingleAsync(x => x.Id == reading)).EvidenceId);
        await migrator.MigrateAsync(previous);
        Assert.Equal(meter, await db.Database.SqlQuery<Guid>($"SELECT \"MeterId\" AS \"Value\" FROM \"OperationalTasks\" WHERE \"Id\" = {task}").SingleAsync());
        await migrator.MigrateAsync();
        db.Add(new OperationalTask { Kind = OperationalTaskKind.AdHoc, LocationId = location, Title = "Synthetic task", Requirements = "Synthetic work", DueAt = DateTimeOffset.UtcNow.AddDays(1) });
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        var exception = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(previous));
        Assert.Contains("Cannot downgrade", exception.MessageText);
        Assert.Equal(2, await db.Set<OperationalTask>().CountAsync());
        Assert.Empty(await db.Set<OperationalTaskHistory>().ToArrayAsync());
    }
}
