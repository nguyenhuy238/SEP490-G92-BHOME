using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class LifecycleMigrationTests
{
    [CompactPostgresFact]
    public async Task ExistingBaselineUpgradesWithoutLosingAccountsAndContactEmailCannotBeClaimedTwice()
    {
        var settings = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN"));
        if (settings.Host is not ("localhost" or "127.0.0.1" or "::1") || settings.Database != "postgres")
            throw new InvalidOperationException("Disposable loopback database required.");
        var name = "bhome_compact24_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(settings.ConnectionString); await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            settings.Database = name;
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(settings.ConnectionString).Options);
            await db.GetService<IMigrator>().MigrateAsync("20261108112733_InitialCompact24");
            var owner = Guid.NewGuid(); var location = Guid.NewGuid(); var room = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
                VALUES ({owner},'synthetic-owner','SYNTHETIC-OWNER','unusable',ARRAY['Owner'],'synthetic','synthetic');
                INSERT INTO locations(id,name,address) VALUES ({location},'Synthetic','Synthetic');
                INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES ({room},{location},'TEST',2,0);
                """);
            await db.GetService<IMigrator>().MigrateAsync("20261110000100_LifecycleAlignment");
            Assert.False(await db.IsSchemaReadyAsync());
            await db.Database.MigrateAsync();
            Assert.True(await db.IsSchemaReadyAsync());
            Assert.Equal(1, await db.Users.CountAsync());
            var person = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO residents(id,current_room_id,identity_owner_scope_id,display_label,verification_status,contact_email)
                VALUES ({person},{room},{owner},'Synthetic A',0,'occupant@example.invalid')
                """);
            var duplicate = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO residents(id,current_room_id,identity_owner_scope_id,display_label,verification_status,contact_email)
                VALUES ({Guid.NewGuid()},{room},{owner},'Synthetic B',0,'OCCUPANT@example.invalid')
                """));
            Assert.Equal("23505", duplicate.SqlState);
            var contract = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contracts(id,room_id,representative_resident_id,owner_signer_id,contract_type,start_date,end_date,deposit_required,terms,status)
                VALUES ({contract},{room},{person},{owner},'MAIN',DATE '2026-11-01',DATE '2026-12-01',0,'Synthetic fixture',0);
                INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from,actual_move_out_date)
                VALUES ({contract},{person},0,DATE '2026-11-01',DATE '2026-11-11');
                """);
            var reversedDates = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contract_residents SET actual_residence_from=DATE '2026-11-12' WHERE contract_id={contract}
                """));
            Assert.Equal("23514", reversedDates.SqlState);
            await db.Database.MigrateAsync();
            Assert.Equal(1, await db.Users.CountAsync());
        }
        finally
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^bhome_compact24_[a-f0-9]{32}$")) throw new InvalidOperationException("Unsafe cleanup.");
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
