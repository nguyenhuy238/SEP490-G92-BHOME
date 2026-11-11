using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;
public sealed class ExternalPayerMigrationTests
{
    [CompactPostgresFact]
    public async Task UpgradePreservesResidentRefundsAndReadinessDetectsTamperedExternalProofFunction()
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
            await db.GetService<IMigrator>().MigrateAsync("20261111060000_ReceiptExcessDisposition");
            var actor = Guid.NewGuid(); var resident = Guid.NewGuid(); var receipt = Guid.NewGuid(); var refund = Guid.NewGuid(); var at = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
                VALUES({actor},'synthetic.migration','SYNTHETIC.MIGRATION','synthetic-unused-hash',ARRAY['Owner'],'synthetic-stamp','synthetic-concurrency');
                INSERT INTO residents(id,identity_owner_scope_id,display_label,verification_status) VALUES({resident},{actor},'Synthetic existing refund recipient',1);
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({receipt},'SYNTHETIC','synthetic','SYNTHETIC-MIGRATION-REF','SYNTHETIC-MIGRATION-EFFECT',{at},100,'VND','VERIFIED','MANUAL',{actor},{at});
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,requested_amount,reason,status,operation_key)
                VALUES({refund},{receipt},{resident},{actor},{at},10,'Synthetic existing pre-upgrade request','REQUESTED',{Guid.NewGuid()});
                """);
            await db.Database.MigrateAsync(); Assert.True(await db.IsSchemaReadyAsync());
            Assert.Equal("RESIDENT", await db.Database.SqlQuery<string>($"SELECT beneficiary_kind AS \"Value\" FROM refund_requests WHERE id={refund}").SingleAsync());
            Assert.Equal(resident, await db.Database.SqlQuery<Guid>($"SELECT beneficiary_resident_id AS \"Value\" FROM refund_requests WHERE id={refund}").SingleAsync());
            Assert.Equal(10, await db.Database.SqlQuery<decimal>($"SELECT requested_amount AS \"Value\" FROM refund_requests WHERE id={refund}").SingleAsync());
            Assert.Null(await db.Database.SqlQuery<Guid?>($"SELECT external_payer_attestation_id AS \"Value\" FROM refund_requests WHERE id={refund}").SingleAsync());
            await db.Database.ExecuteSqlRawAsync("CREATE OR REPLACE FUNCTION bhome24_external_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT true $fn$;");
            Assert.False(await db.IsSchemaReadyAsync());
        }
        finally
        {
            // Name is created above from the fixed disposable prefix and a generated GUID only.
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{name}\" WITH (FORCE)", connection); await drop.ExecuteNonQueryAsync();
        }
    }
}
