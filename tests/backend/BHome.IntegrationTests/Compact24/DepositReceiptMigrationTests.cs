using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;
public sealed class DepositReceiptMigrationTests
{
    [CompactPostgresFact]
    public async Task UpgradePreservesOldOverCapHistoryButRejectsNewOverCreditAndDetectsTamperedProof()
    {
        var admin = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN"));
        if (admin.Host is not ("localhost" or "127.0.0.1" or "::1") || admin.Database != "postgres") throw new InvalidOperationException("Disposable loopback admin required");
        var name = "bhome_compact24_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(admin.ConnectionString); await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection)) await create.ExecuteNonQueryAsync();
        try
        {
            var target = new NpgsqlConnectionStringBuilder(admin.ConnectionString) { Database = name };
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(target.ConnectionString).Options);
            await db.GetService<IMigrator>().MigrateAsync("20261111070000_ExternalPaymentPayer");
            var actor = Guid.NewGuid(); var resident = Guid.NewGuid(); var location = Guid.NewGuid(); var room = Guid.NewGuid(); var contract = Guid.NewGuid(); var receipt = Guid.NewGuid(); var allocation = Guid.NewGuid(); var at = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
                VALUES({actor},'synthetic.deposit.migration','SYNTHETIC.DEPOSIT.MIGRATION','synthetic-unused-hash',ARRAY['Owner'],'synthetic-stamp','synthetic-concurrency');
                INSERT INTO locations(id,name,address) VALUES({location},'Synthetic migration','Synthetic');
                INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES({room},{location},'SYNTHETIC',1,0);
                INSERT INTO residents(id,identity_owner_scope_id,display_label,verification_status) VALUES({resident},{actor},'Synthetic existing depositor',1);
                INSERT INTO contracts(id,room_id,representative_resident_id,owner_signer_id,contract_type,start_date,end_date,deposit_required,terms,status)
                VALUES({contract},{room},{resident},{actor},'MAIN','2026-11-01','2027-11-01',0,'Synthetic pre-upgrade historical deposit mismatch',0);
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({receipt},'SYNTHETIC','synthetic','SYN-MIGRATION-DEP','SYN-MIGRATION-DEP',{at},100,'VND','VERIFIED','MANUAL',{actor},{at});
                INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({allocation},{receipt},{contract},100,{Guid.NewGuid()},1,{actor},{at},'Synthetic historical over-cap deposit');
                """);
            await db.Database.MigrateAsync(); Assert.True(await db.IsSchemaReadyAsync());
            Assert.Equal(100, await db.Database.SqlQuery<decimal>($"SELECT amount AS \"Value\" FROM payment_allocations WHERE id={allocation}").SingleAsync());
            Assert.Equal(0, await db.Database.SqlQuery<decimal>($"SELECT deposit_required AS \"Value\" FROM contracts WHERE id={contract}").SingleAsync());
            var rejected = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({Guid.NewGuid()},{receipt},{contract},1,{Guid.NewGuid()},1,{actor},{at},'Synthetic attempted new over-credit')
                """)); Assert.Equal("23514", rejected.SqlState);
            await db.Database.ExecuteSqlRawAsync("CREATE OR REPLACE FUNCTION bhome24_deposit_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT true $fn$;");
            Assert.False(await db.IsSchemaReadyAsync());
        }
        finally
        {
            // Only the generated loopback disposable DB created above is dropped.
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection); await drop.ExecuteNonQueryAsync();
        }
    }
}
