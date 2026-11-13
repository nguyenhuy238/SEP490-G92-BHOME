using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class PersonMonthlyFeeMigrationTests
{
    [CompactPostgresFact]
    public async Task UpgradePreservesExistingFeeHistoryAndRejectsNewInvalidMethods()
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
            await db.GetService<IMigrator>().MigrateAsync("20261112000100_SePayIntegration");
            var location = Guid.NewGuid(); var old = Guid.NewGuid(); var historical = Guid.NewGuid();
            var today = new DateOnly(2026, 11, 1);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO locations(id,name,address) VALUES({location},'Synthetic fee upgrade','Synthetic');
                INSERT INTO billing_policies(id,location_id,charge_code,category,calculation_method,rate,effective_from)
                VALUES({old},{location},'CLEANING',3,'FIXED_PER_ROOM_PER_MONTH',100000,{today}),
                      ({historical},{location},'UNKNOWN_HISTORICAL',3,'UNKNOWN_LEGACY_METHOD',5000,{today});
                """);
            await db.Database.MigrateAsync();
            Assert.True(await db.IsSchemaReadyAsync());
            var before = await db.Set<BillingPolicy>().AsNoTracking().SingleAsync(p => p.Id == old);
            Assert.Equal(ChargingMethod.FixedPerRoomPerMonth, before.Method);
            Assert.Equal(100000m, before.Rate);
            Assert.Equal("UNKNOWN_LEGACY_METHOD", await db.Database.SqlQuery<string>($"SELECT calculation_method AS \"Value\" FROM billing_policies WHERE id={historical}").SingleAsync());
            var fee = new BillingPolicy
            {
                LocationId = location,
                Category = ChargeCategory.ServiceFee,
                ChargeCode = "PER_PERSON",
                Name = "Synthetic person fee",
                Method = ChargingMethod.FixedPerPersonPerMonth,
                Rate = 125000.1234m,
                EffectiveFrom = today
            };
            db.Add(fee); await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
            var saved = await db.Set<BillingPolicy>().AsNoTracking().SingleAsync(p => p.Id == fee.Id);
            Assert.Equal(ChargingMethod.FixedPerPersonPerMonth, saved.Method); Assert.Equal(fee.Rate, saved.Rate);
            var rejected = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO billing_policies(id,location_id,charge_code,category,calculation_method,rate,effective_from)
                VALUES({Guid.NewGuid()},{location},'RENT',0,'FIXED_PER_PERSON_PER_MONTH',100000,{today});
                """));
            Assert.Equal("23514", rejected.SqlState);
        }
        finally
        {
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
