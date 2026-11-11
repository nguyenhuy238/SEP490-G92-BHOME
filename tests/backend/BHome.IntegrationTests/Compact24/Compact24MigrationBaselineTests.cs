using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence.Compact24.Migrations;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24MigrationBaselineTests
{
    [Fact]
    public void SnapshotMatchesRuntimeAndContainsOnlyTheRuntimeBaseline()
    {
        using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=offline_snapshot;Username=unconfigured").Options);
        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Equal([Compact24Baseline.Id, "20261110000100_LifecycleAlignment", "20261111000100_PhysicalResidenceClosure", "20261111035703_SettlementReceivableLedger", "20261111050000_SettlementBankAllocations"], db.Database.GetMigrations());
        Assert.Contains("CREATE TABLE users", Compact24Baseline.MigrationSql);
        Assert.DoesNotContain("\nCOMMIT;", Compact24Baseline.MigrationSql);
    }

    [Theory]
    [InlineData("Host=ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require", "development")]
    [InlineData("Host=ep-curly-leaf-aoxpcuzr.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require", "development")]
    [InlineData("Host=ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require", "production")]
    [InlineData("Host=ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=Require;Channel Binding=Require", "development")]
    [InlineData("Host=127.0.0.1;Database=bhome", "development")]
    public void FactoryRejectsPooledProductionInsecureAndNonDisposableLocalTargets(string connection, string branch) =>
        Assert.Throws<InvalidOperationException>(() => Compact24DbContextFactory.ValidateTarget(connection, branch));

    [Fact]
    public async Task BaselineCreatesExactlyTheReviewedSchemaAndSeparateHistoryAndReplaysWithoutDataLoss()
    {
        await using var postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
        await postgres.StartAsync();
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(postgres.GetConnectionString()).Options);
        await db.Database.MigrateAsync();
        Assert.True(await db.IsSchemaReadyAsync());
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
            VALUES ('c2400000-0000-4000-8000-000000009999','baseline.synthetic','BASELINE.SYNTHETIC','synthetic-unused-hash',ARRAY['Owner'],'synthetic-stamp','synthetic-concurrency')
            """);
        await db.Database.MigrateAsync();
        Assert.Equal(1, await db.Users.CountAsync());
        await db.Database.OpenConnectionAsync();
        await using var count = new NpgsqlCommand("SELECT count(*) FROM pg_tables WHERE schemaname='public'", (NpgsqlConnection)db.Database.GetDbConnection());
        Assert.Equal(24L, await count.ExecuteScalarAsync());
    }

    [Fact]
    public async Task BaselineRefusesExistingRuntimeRatherThanAssumingMigrationHistory()
    {
        await using var postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
        await postgres.StartAsync();
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(postgres.GetConnectionString()).Options);
        await using var schema = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
        using var reader = new StreamReader(schema);
        await db.Database.OpenConnectionAsync();
        await using (var create = new NpgsqlCommand(await reader.ReadToEndAsync(), (NpgsqlConnection)db.Database.GetDbConnection()))
            await create.ExecuteNonQueryAsync();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.MigrateAsync());
        Assert.True(await db.IsSchemaReadyAsync());
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }
}
