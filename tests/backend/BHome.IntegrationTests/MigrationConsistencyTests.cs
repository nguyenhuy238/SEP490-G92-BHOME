using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

namespace BHome.IntegrationTests;

public sealed class MigrationConsistencyTests
{
    private static BHomeDbContext CreateContext() => new(new DbContextOptionsBuilder<BHomeDbContext>()
        .UseNpgsql("Host=127.0.0.1;Database=synthetic_migration_metadata;Username=unconfigured")
        .Options);

    [Fact]
    public void SnapshotMatchesCurrentModel()
    {
        using var db = CreateContext();
        Assert.False(db.Database.HasPendingModelChanges());
    }

    [Fact]
    public void EveryMigrationTargetModelContainsAllTablesCreatedUpToThatPoint()
    {
        using var db = CreateContext();
        var assembly = db.GetService<IMigrationsAssembly>();
        var tables = new HashSet<string>();
        foreach (var migrationType in assembly.Migrations.Values)
        {
            var migration = assembly.CreateMigration(migrationType, db.Database.ProviderName!);
            foreach (var operation in migration.UpOperations)
            {
                if (operation is CreateTableOperation create) tables.Add(create.Name);
                if (operation is DropTableOperation drop) tables.Remove(drop.Name);
            }
            var model = db.GetService<IModelRuntimeInitializer>().Initialize(migration.TargetModel, designTime: true);
            Assert.Equal(tables.Order(), model.GetRelationalModel().Tables.Select(table => table.Name).Order());
        }
    }

    [Fact]
    public void OnlyPropertyMigrationOwnsRoomStatusColumn()
    {
        using var db = CreateContext();
        var assembly = db.GetService<IMigrationsAssembly>();
        var migrations = assembly.Migrations.Select(pair => (
            Id: pair.Key, Migration: assembly.CreateMigration(pair.Value, db.Database.ProviderName!))).ToArray();
        var additions = migrations.Where(x => x.Migration.UpOperations.OfType<AddColumnOperation>()
            .Any(column => column.Table == "Rooms" && column.Name == "Status")).ToArray();
        var removals = migrations.Where(x => x.Migration.DownOperations.OfType<DropColumnOperation>()
            .Any(column => column.Table == "Rooms" && column.Name == "Status")).ToArray();

        Assert.Equal("20261029154537_PropertyConfiguration", Assert.Single(additions).Id);
        Assert.Equal("20261029154537_PropertyConfiguration", Assert.Single(removals).Id);
    }
}
