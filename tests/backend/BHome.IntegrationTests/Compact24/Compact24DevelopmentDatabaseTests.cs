using System.Net;
using BHome.Api.Configuration;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24DevelopmentDatabaseTests
{
    [CompactPostgresFact]
    public async Task MissingDatabaseInitializesOnceUnderConcurrentStartupAndPreservesDataOnRestart()
    {
        await using var database = new DevelopmentFixture();
        Assert.Equal("MISSING", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
        Assert.False(await database.Exists());
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection)));
        Assert.Single(results, r => r.State == "INITIALIZED"); Assert.Single(results, r => r.State == "READY");
        var oid = await database.Oid();
        await using var connection = new NpgsqlConnection(database.Connection); await connection.OpenAsync();
        await using (var insert = new NpgsqlCommand("INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at) VALUES(gen_random_uuid(),'AUDIT','synthetic-startup-preserve','SyntheticFixture','{}',now())", connection))
            await insert.ExecuteNonQueryAsync();
        Assert.Equal("READY", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, archiveLegacy: true)).State);
        Assert.Equal(oid, await database.Oid());
        await using var count = new NpgsqlCommand("SELECT count(*) FROM notifications", connection); Assert.Equal(1L, await count.ExecuteScalarAsync());
    }

    [CompactPostgresFact]
    public async Task LegacyReplacementIsExplicitAndKeepsWholeOldDatabaseIncludingActiveConnectionData()
    {
        await using var database = new DevelopmentFixture(); await database.Create();
        var marker = "Synthetic preserved " + Guid.NewGuid().ToString("N");
        await using (var source = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(database.Connection).Options))
        {
            await source.Database.MigrateAsync();
            source.Add(new Location(marker) { ChainId = await source.Set<BHome.Domain.PropertyManagement.Chain>().Select(c => c.Id).SingleAsync() });
            await source.SaveChangesAsync();
        }
        var oid = await database.Oid();
        Assert.Equal("LEGACY_REQUIRES_RECREATE", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
        Assert.Equal("legacy_requires_explicit_recreate", (await Assert.ThrowsAsync<DevelopmentDatabaseException>(() =>
            Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection))).Code);
        Assert.Equal(oid, await database.Oid());
        await using var oldSession = new NpgsqlConnection(database.Connection); await oldSession.OpenAsync();
        var result = await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, archiveLegacy: true);
        database.Backup = result.BackupDatabase;
        Assert.Equal("LEGACY_ARCHIVED_AND_INITIALIZED", result.State); Assert.NotNull(database.Backup);
        Assert.NotEqual(oid, await database.Oid());
        var backupSettings = new NpgsqlConnectionStringBuilder(database.Connection) { Database = database.Backup };
        await using var backup = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(backupSettings.ConnectionString).Options);
        Assert.Equal(marker, (await backup.Locations.SingleAsync()).Name);
        Assert.Empty(await backup.Database.GetPendingMigrationsAsync());
        await using var target = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(database.Connection).Options);
        Assert.True(await target.IsSchemaReadyAsync()); Assert.Empty(await target.Users.ToArrayAsync());
    }

    [CompactPostgresFact]
    public async Task UnknownPopulatedSchemaIsNeverArchivedOrOverwritten()
    {
        await using var database = new DevelopmentFixture(); await database.Create();
        await using var connection = new NpgsqlConnection(database.Connection); await connection.OpenAsync();
        await using (var seed = new NpgsqlCommand("CREATE TABLE synthetic_unrecognized(id integer PRIMARY KEY); INSERT INTO synthetic_unrecognized VALUES(7)", connection)) await seed.ExecuteNonQueryAsync();
        var oid = await database.Oid();
        Assert.Equal("unrecognized_existing_schema", (await Assert.ThrowsAsync<DevelopmentDatabaseException>(() =>
            Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, archiveLegacy: true))).Code);
        Assert.Equal(oid, await database.Oid());
        await using var read = new NpgsqlCommand("SELECT id FROM synthetic_unrecognized", connection); Assert.Equal(7, await read.ExecuteScalarAsync());
    }

    [CompactPostgresFact]
    public async Task DevelopmentApiStartupCreatesFreshCompactSchemaAndReadinessSucceeds()
    {
        await using var database = new DevelopmentFixture();
        using var root = new ApiFactory { ConnectionString = database.Connection, UseCompact24 = true };
        await using var host = root.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["DevelopmentDatabase:InitializeOnStartup"] = "true" }));
        });
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        Assert.Equal("READY", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
    }

    [CompactPostgresFact]
    public async Task PropertyUpgradeRemovesRetiredColumnsAtomicallyAndCanBeRepeated()
    {
        await using var database = new DevelopmentFixture();
        await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection);
        await RestorePreviousPropertyShape(database.Connection);
        Assert.Equal("PROPERTY_UPGRADE_REQUIRED", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
        Assert.Equal("UPGRADED", (await Compact24PropertyUpgrade.ApplyAsync("Development", database.Connection)).State);
        Assert.Equal("READY", (await Compact24PropertyUpgrade.ApplyAsync("Development", database.Connection)).State);
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(database.Connection).Options);
        Assert.True(await db.IsSchemaReadyAsync());
    }

    [CompactPostgresFact]
    public async Task PropertyUpgradeRefusesToDiscardCatalogDataAndRollsBack()
    {
        await using var database = new DevelopmentFixture();
        await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection);
        await RestorePreviousPropertyShape(database.Connection);
        await using var connection = new NpgsqlConnection(database.Connection); await connection.OpenAsync();
        await using (var seed = new NpgsqlCommand("INSERT INTO locations(id,name,address,room_types) VALUES(gen_random_uuid(),'Synthetic upgrade','Synthetic address','[{\"id\":\"synthetic-catalog-marker\"}]')", connection))
            await seed.ExecuteNonQueryAsync();
        Assert.Equal("property_upgrade_rejected_23514", (await Assert.ThrowsAsync<DevelopmentDatabaseException>(() =>
            Compact24PropertyUpgrade.ApplyAsync("Development", database.Connection))).Code);
        await using var check = new NpgsqlCommand("SELECT room_types->0->>'id' FROM locations", connection);
        Assert.Equal("synthetic-catalog-marker", await check.ExecuteScalarAsync());
        Assert.Equal("PROPERTY_UPGRADE_REQUIRED", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
    }

    [CompactPostgresFact]
    public async Task Native383ColumnSchemaCanRefreshGuardsWithoutChangingColumns()
    {
        await using var database = new DevelopmentFixture();
        await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection);
        await using var connection = new NpgsqlConnection(database.Connection); await connection.OpenAsync();
        await using (var remove = new NpgsqlCommand("DROP TRIGGER work_order_consistent ON operational_tasks; DROP FUNCTION bhome24_work_order_guard()", connection))
            await remove.ExecuteNonQueryAsync();
        Assert.Equal("UPGRADED", (await Compact24PropertyUpgrade.ApplyAsync("Development", database.Connection)).State);
        await using var count = new NpgsqlCommand("SELECT count(*) FROM information_schema.columns WHERE table_schema='public'", connection);
        Assert.Equal(383L, await count.ExecuteScalarAsync());
        Assert.Equal("READY", (await Compact24DevelopmentDatabase.PrepareAsync("Development", database.Connection, checkOnly: true)).State);
    }

    private static async Task RestorePreviousPropertyShape(string connectionString)
    {
        // Build only the retired shape on a fresh native fixture. Existing auth,
        // finance and append-only guards remain enabled throughout this test.
        await using var connection = new NpgsqlConnection(connectionString); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            ALTER TABLE locations ADD COLUMN room_types jsonb NOT NULL DEFAULT '[]';
            ALTER TABLE rooms ADD COLUMN room_type_id uuid;
            ALTER TABLE billing_policies ADD COLUMN room_type_id uuid;
            DROP TRIGGER work_order_consistent ON operational_tasks;
            DROP FUNCTION bhome24_work_order_guard();
            CREATE FUNCTION bhome24_location_catalog_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
            CREATE FUNCTION bhome24_property_catalog_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
            CREATE TRIGGER location_catalog_consistent BEFORE INSERT ON locations FOR EACH ROW EXECUTE FUNCTION bhome24_location_catalog_guard();
            CREATE TRIGGER room_catalog_reference BEFORE INSERT ON rooms FOR EACH ROW EXECUTE FUNCTION bhome24_property_catalog_reference_guard();
            CREATE TRIGGER policy_catalog_reference BEFORE INSERT ON billing_policies FOR EACH ROW EXECUTE FUNCTION bhome24_property_catalog_reference_guard();
            """, connection);
        await command.ExecuteNonQueryAsync();
    }

    private sealed class DevelopmentFixture : IAsyncDisposable
    {
        private readonly string admin = Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")!;
        private readonly string name = "bhome_compact24_dev_" + Guid.NewGuid().ToString("N");
        public string? Backup { get; set; }
        public string Connection => new NpgsqlConnectionStringBuilder(admin) { Database = name, Pooling = false }.ConnectionString;
        public async Task Create() { await using var db = await Admin(); await using var cmd = new NpgsqlCommand("CREATE DATABASE " + new NpgsqlCommandBuilder().QuoteIdentifier(name), db); await cmd.ExecuteNonQueryAsync(); }
        public async Task<bool> Exists() { await using var db = await Admin(); await using var cmd = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=@name)", db); cmd.Parameters.AddWithValue("name", name); return (bool)(await cmd.ExecuteScalarAsync())!; }
        public async Task<uint> Oid() { await using var db = await Admin(); await using var cmd = new NpgsqlCommand("SELECT oid FROM pg_database WHERE datname=@name", db); cmd.Parameters.AddWithValue("name", name); return (uint)(await cmd.ExecuteScalarAsync())!; }
        private async Task<NpgsqlConnection> Admin()
        {
            var settings = new NpgsqlConnectionStringBuilder(admin);
            if (settings.Host is not ("localhost" or "127.0.0.1" or "::1") || settings.Database != "postgres") throw new InvalidOperationException("Explicit loopback fixture admin required.");
            var db = new NpgsqlConnection(admin); await db.OpenAsync(); return db;
        }
        public async ValueTask DisposeAsync()
        {
            await using var db = await Admin();
            foreach (var owned in new[] { name, Backup }.Where(n => n is not null))
            {
                if (owned != name && !System.Text.RegularExpressions.Regex.IsMatch(owned!, "^bhome_legacy_[0-9]{8}_[0-9]{6}Z_[a-f0-9]{8}$")) throw new InvalidOperationException("Fixture cleanup target rejected.");
                await using var cmd = new NpgsqlCommand("DROP DATABASE IF EXISTS " + new NpgsqlCommandBuilder().QuoteIdentifier(owned!) + " WITH (FORCE)", db); await cmd.ExecuteNonQueryAsync();
            }
        }
    }
}

public sealed class DevelopmentDatabaseSafetyTests
{
    [Theory]
    [InlineData("Production", "Host=127.0.0.1;Database=bhome", "development_environment_required")]
    [InlineData("Testing", "Host=127.0.0.1;Database=bhome", "development_environment_required")]
    [InlineData("Development", "Host=remote.invalid;Database=bhome", "dedicated_loopback_development_database_required")]
    [InlineData("Development", "Host=127.0.0.1;Database=postgres", "dedicated_loopback_development_database_required")]
    [InlineData("Development", "Host=127.0.0.1;Database=another_app", "dedicated_loopback_development_database_required")]
    public async Task InvalidTargetsFailBeforeConnecting(string environment, string connection, string code) =>
        Assert.Equal(code, (await Assert.ThrowsAsync<DevelopmentDatabaseException>(() => Compact24DevelopmentDatabase.PrepareAsync(environment, connection, archiveLegacy: true))).Code);

    [Fact]
    public void DotEnvFallbackOverridesAppSettingsButPreservesExplicitOverridesAndDoesNotEvaluateText()
    {
        var directory = Path.Combine(Path.GetTempPath(), "bhome-dev-config-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var json = Path.Combine(directory, "appsettings.Development.json"); var dotenv = Path.Combine(directory, ".env");
        try
        {
            File.WriteAllText(json, "{\"Jobs\":{\"Enabled\":false},\"Jwt\":{\"SigningKey\":\"synthetic-default\"}}");
            File.WriteAllText(dotenv, "Jobs__Enabled=true\nJwt__SigningKey=synthetic-file\nConnectionStrings__Database='synthetic-$(not-executed)'\nUNRELATED__Value=ignored");
            var configuration = new ConfigurationManager(); configuration.AddJsonFile(json);
            configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = "synthetic-explicit" });
            DevelopmentEnvironmentFile.AddFile(configuration, dotenv);
            Assert.True(configuration.GetValue<bool>("Jobs:Enabled")); Assert.Equal("synthetic-explicit", configuration["Jwt:SigningKey"]);
            Assert.Equal("synthetic-$(not-executed)", configuration["ConnectionStrings:Database"]); Assert.Null(configuration["UNRELATED:Value"]);
        }
        finally { File.Delete(json); File.Delete(dotenv); Directory.Delete(directory); }
    }
}
