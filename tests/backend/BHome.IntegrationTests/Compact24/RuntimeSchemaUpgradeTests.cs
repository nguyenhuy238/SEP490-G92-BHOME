using BHome.DatabaseCheck;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class RuntimeSchemaUpgradeTests
{
    [CompactPostgresFact]
    public async Task ReadinessStillRejectsModifiedGuardBodyAfterCatalogBatching()
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try
        {
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(fixture.Connection).Options);
            Assert.True(await db.IsSchemaReadyAsync());
            await using (var tx = await db.Database.BeginTransactionAsync())
            {
                await db.Database.ExecuteSqlRawAsync("""
                    CREATE OR REPLACE FUNCTION bhome24_sepay_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
                    BEGIN RETURN NEW; END $fn$;
                    """);
                Assert.False(await db.IsSchemaReadyAsync());
                await tx.RollbackAsync();
            }
            Assert.True(await db.IsSchemaReadyAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task BaselineUpgradeRepairsMissingRuntimeColumnsAndPreservesExistingRecords()
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
            await db.GetService<IMigrator>().MigrateAsync("20261108112733_InitialCompact24");
            var actor = Guid.NewGuid(); var resident = Guid.NewGuid(); var location = Guid.NewGuid(); var room = Guid.NewGuid(); var contract = Guid.NewGuid(); var receipt = Guid.NewGuid(); var at = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
                VALUES({actor},'synthetic.upgrade','SYNTHETIC.UPGRADE','synthetic-unused-hash',ARRAY['Owner'],'synthetic-stamp','synthetic-concurrency');
                INSERT INTO locations(id,name,address) VALUES({location},'Synthetic upgrade','Synthetic');
                INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES({room},{location},'SYNTHETIC',1,0);
                INSERT INTO residents(id,identity_owner_scope_id,display_label,verification_status) VALUES({resident},{actor},'Synthetic existing Resident',1);
                INSERT INTO contracts(id,room_id,representative_resident_id,owner_signer_id,contract_type,start_date,end_date,deposit_required,terms,status)
                VALUES({contract},{room},{resident},{actor},'MAIN','2026-11-01','2027-11-01',100,'Synthetic existing terms',0);
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({receipt},'SYNTHETIC','synthetic','SYN-UPGRADE','SYN-UPGRADE',{at},100,'VND','VERIFIED','MANUAL',{actor},{at});
                INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({Guid.NewGuid()},{receipt},{contract},75,{Guid.NewGuid()},1,{actor},{at},'Synthetic existing allocation');
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,requested_amount,reason,status,operation_key)
                VALUES({Guid.NewGuid()},{receipt},{resident},{actor},{at},25,'Synthetic retained refund','REQUESTED',{Guid.NewGuid()});
                """);
            var tables = new[] { "users", "locations", "rooms", "residents", "contracts", "payments", "payment_allocations", "refund_requests" };
            async Task<string[]> Snapshot()
            {
                var result = new List<string>();
                foreach (var table in tables)
                {
                    // Names are this fixed fixture allowlist; no user input enters SQL identifiers.
                    var sql = $"SELECT COALESCE(jsonb_agg(to_jsonb(t)-ARRAY['contact_email','target_settlement_contract_id','settlement_receivable_id','deposit_offset_approval_id','beneficiary_kind','external_payer_attestation_id'] ORDER BY id),'[]'::jsonb)::text AS \"Value\" FROM {table} t";
                    result.Add(await db.Database.SqlQueryRaw<string>(sql).SingleAsync());
                }
                return result.ToArray();
            }
            var before = await Snapshot();
            Assert.False(await db.IsSchemaReadyAsync());
            var missing = await Assert.ThrowsAsync<PostgresException>(() => db.Database.SqlQuery<string>(
                $"SELECT contact_email AS \"Value\" FROM residents LIMIT 0").ToArrayAsync());
            Assert.Equal("42703", missing.SqlState);
            using var diagnostics = new StringWriter();
            var pending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
            Assert.Equal(2, await DatabaseProbe.RunAsync(target.ConnectionString, diagnostics));
            Assert.Contains($"applied=1; pending={pending.Length}; unknown=0", diagnostics.ToString());
            Assert.Contains($"PendingCompact24Migrations={string.Join(',', pending)}", diagnostics.ToString());
            Assert.Contains("20261110000100_LifecycleAlignment", diagnostics.ToString());
            Assert.Contains("20261111080000_DepositReceiptAllocation", diagnostics.ToString());
            Assert.Contains("20261113000100_PersonMonthlyServiceFees", diagnostics.ToString());
            var upgrade = db.GetService<IMigrator>().GenerateScript("20261108112733_InitialCompact24", null, MigrationsSqlGenerationOptions.NoTransactions);
            await using (var transaction = await db.Database.BeginTransactionAsync())
            {
                await using var command = new NpgsqlCommand(upgrade, (NpgsqlConnection)db.Database.GetDbConnection(),
                    (NpgsqlTransaction)transaction.GetDbTransaction());
                await command.ExecuteNonQueryAsync();
                await transaction.CommitAsync();
            }
            Assert.True(await db.IsSchemaReadyAsync()); Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            Assert.Equal(before, await Snapshot());
            await db.Database.MigrateAsync(); Assert.Equal(before, await Snapshot());
            Assert.Empty(await db.Database.SqlQuery<string>($"SELECT contact_email AS \"Value\" FROM residents LIMIT 0").ToArrayAsync());
        }
        finally
        {
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection); await drop.ExecuteNonQueryAsync();
        }
    }
}
