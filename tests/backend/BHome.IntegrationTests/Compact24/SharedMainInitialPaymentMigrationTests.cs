using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class SharedMainInitialPaymentMigrationTests
{
    [CompactPostgresFact]
    public async Task UpgradeChangesOnlyInitialPaymentGuardAndPreservesExistingRows()
    {
        var admin = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN"));
        if (admin.Host is not ("localhost" or "127.0.0.1" or "::1") || admin.Database != "postgres")
            throw new InvalidOperationException("Disposable loopback admin required");
        var name = "bhome_compact24_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(admin.ConnectionString);
        await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection)) await create.ExecuteNonQueryAsync();
        try
        {
            var target = new NpgsqlConnectionStringBuilder(admin.ConnectionString) { Database = name };
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(target.ConnectionString).Options);
            await db.GetService<IMigrator>().MigrateAsync("20261115181024_AssetHandoverInventoryProjection");
            var location = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address) VALUES({location},'Synthetic schema upgrade','Synthetic')");
            async Task<string[]> Functions() => await db.Database.SqlQuery<string>($"""
                SELECT proname || ':' || prosrc AS "Value" FROM pg_proc
                WHERE pronamespace='public'::regnamespace ORDER BY proname,oid
                """).ToArrayAsync();
            var before = await Functions();
            Assert.False(await db.IsSchemaReadyAsync());

            await db.Database.MigrateAsync();

            Assert.True(await db.IsSchemaReadyAsync());
            var after = await Functions();
            const string guard = "bhome24_initial_payment_guard:";
            const string sepayGuard = "bhome24_sepay_technical_guard:";
            const string settlementGuard = "bhome24_settlement_allocation_guard:";
            Assert.Equal(before.Where(f => !f.StartsWith(guard, StringComparison.Ordinal) && !f.StartsWith(sepayGuard, StringComparison.Ordinal) && !f.StartsWith(settlementGuard, StringComparison.Ordinal)),
                after.Where(f => !f.StartsWith(guard, StringComparison.Ordinal) && !f.StartsWith(sepayGuard, StringComparison.Ordinal) && !f.StartsWith(settlementGuard, StringComparison.Ordinal)));
            Assert.NotEqual(before.Single(f => f.StartsWith(guard, StringComparison.Ordinal)), after.Single(f => f.StartsWith(guard, StringComparison.Ordinal)));
            Assert.NotEqual(before.Single(f => f.StartsWith(sepayGuard, StringComparison.Ordinal)), after.Single(f => f.StartsWith(sepayGuard, StringComparison.Ordinal)));
            Assert.NotEqual(before.Single(f => f.StartsWith(settlementGuard, StringComparison.Ordinal)), after.Single(f => f.StartsWith(settlementGuard, StringComparison.Ordinal)));
            Assert.Equal("Synthetic schema upgrade", await db.Database.SqlQuery<string>($"SELECT name AS \"Value\" FROM locations WHERE id={location}").SingleAsync());
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());

            // VPS databases bootstrapped from SQL have no EF history. The reviewed
            // operator path applies only this resource, without adopting a baseline.
            await using var stream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.SharedMainInitialPayment.sql")!;
            using var reader = new StreamReader(stream);
            await db.Database.ExecuteSqlRawAsync(await reader.ReadToEndAsync());
            await db.Database.MigrateAsync();
            Assert.Equal(after, await Functions());
            Assert.True(await db.IsSchemaReadyAsync());
            Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM locations WHERE id={location}").SingleAsync());

            await using (var transaction = await db.Database.BeginTransactionAsync())
            {
                await db.Database.ExecuteSqlRawAsync("""
                    CREATE OR REPLACE FUNCTION bhome24_sepay_technical_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
                    BEGIN RETURN NEW; END $fn$;
                    """);
                Assert.False(await db.IsSchemaReadyAsync());
                await transaction.RollbackAsync();
            }
            Assert.True(await db.IsSchemaReadyAsync());
        }
        finally
        {
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
