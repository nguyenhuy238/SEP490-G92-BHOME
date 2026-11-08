using System.Net;
using System.Net.Sockets;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.DatabaseCheck;

// Metadata only, inside a read-only transaction. Never initializes, seeds or migrates a database.
public static class DatabaseProbe
{
    public static NpgsqlConnectionStringBuilder Validate(string? connectionString)
    {
        NpgsqlConnectionStringBuilder settings;
        try { settings = new(connectionString ?? ""); }
        catch (ArgumentException) { throw new InvalidOperationException("invalid_npgsql_configuration"); }
        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.Database))
            throw new InvalidOperationException("host_and_database_required");
        if (settings.Host.EndsWith(".neon.tech", StringComparison.OrdinalIgnoreCase) &&
            (settings.SslMode != SslMode.VerifyFull || settings.ChannelBinding != ChannelBinding.Require ||
             settings.TryGetValue("Trust Server Certificate", out var trust) && trust is true ||
             settings.NoResetOnClose || settings.Multiplexing))
            throw new InvalidOperationException("neon_requires_verify_full_channel_binding_and_connection_reset");
        settings.IncludeErrorDetail = false;
        settings.LogParameters = false;
        settings.PersistSecurityInfo = false;
        settings.Pooling = false;
        settings.Timeout = 20;
        settings.CommandTimeout = 30;
        settings.ApplicationName = "BHome.DatabaseCheck.ReadOnly";
        return settings;
    }

    public static async Task<int> RunAsync(string? connectionString, TextWriter output, CancellationToken token = default)
    {
        var stage = "configuration";
        try
        {
            var settings = Validate(connectionString);
            await output.WriteLineAsync($"Target host={settings.Host}; database={settings.Database}; branch=UNVERIFIED_CONSOLE_REQUIRED");
            stage = "dns";
            var addresses = await Dns.GetHostAddressesAsync(settings.Host!, token);
            await output.WriteLineAsync($"DNS=PASS; addresses={addresses.Length}");
            stage = "tcp";
            using (var tcp = new TcpClient())
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                await tcp.ConnectAsync(settings.Host!, settings.Port, timeout.Token);
            }
            await output.WriteLineAsync("TCP=PASS");
            stage = "npgsql_tls_auth";
            await using var connection = new NpgsqlConnection(settings.ConnectionString);
            await connection.OpenAsync(token);
            await output.WriteLineAsync($"Npgsql=PASS; SSLMode={settings.SslMode}; ChannelBinding={settings.ChannelBinding}; server={connection.PostgreSqlVersion}");
            await using var transaction = await connection.BeginTransactionAsync(token);
            await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, transaction))
                await readOnly.ExecuteNonQueryAsync(token);
            stage = "metadata";
            await using (var query = new NpgsqlCommand("SELECT current_database(),current_user,current_setting('transaction_read_only')", connection, transaction))
            await using (var reader = await query.ExecuteReaderAsync(token))
            {
                await reader.ReadAsync(token);
                await output.WriteLineAsync($"Database={reader.GetString(0)}; role={reader.GetString(1)}; read_only={reader.GetString(2)}");
            }
            var tables = new List<string>();
            await using (var query = new NpgsqlCommand("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", connection, transaction))
            await using (var reader = await query.ExecuteReaderAsync(token))
                while (await reader.ReadAsync(token)) tables.Add(reader.GetString(0));
            await output.WriteLineAsync($"PublicTables={tables.Count}; names={string.Join(',', tables)}");
            // Read the source assembly catalog without connecting the legacy context to Neon.
            await using var source = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>()
                .UseNpgsql("Host=localhost;Database=offline_catalog;Username=unconfigured").Options);
            var known = source.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
            if (tables.Contains("__EFMigrationsHistory"))
            {
                var applied = new List<string>();
                await using var query = new NpgsqlCommand("SELECT \"MigrationId\" FROM public.\"__EFMigrationsHistory\" ORDER BY \"MigrationId\"", connection, transaction);
                await using var reader = await query.ExecuteReaderAsync(token);
                while (await reader.ReadAsync(token)) applied.Add(reader.GetString(0));
                await output.WriteLineAsync($"LegacyEFHistory=PRESENT; applied={applied.Count}; pending_source={known.Except(applied).Count()}; unknown={applied.Except(known).Count()}; DO_NOT_APPLY_TO_COMPACT24");
            }
            else await output.WriteLineAsync($"LegacyEFHistory=ABSENT; source_migrations={known.Count}; runtime_schema=SEPARATE_COMPACT24_DDL");
            stage = "compact24_schema";
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(connection).Options);
            await db.Database.UseTransactionAsync(transaction, token);
            var ready = await db.IsSchemaReadyAsync(token);
            await output.WriteLineAsync($"Compact24={(ready ? "PASS" : "INCOMPATIBLE_OR_EMPTY")}; expected={Compact24Schema.Version}");
            await using (var history = new NpgsqlCommand("SELECT to_regclass('bhome_meta.\"__EFMigrationsHistory\"') IS NOT NULL", connection, transaction))
            {
                if ((bool)(await history.ExecuteScalarAsync(token))!)
                {
                    var applied = (await db.Database.GetAppliedMigrationsAsync(token)).ToArray();
                    var runtime = db.Database.GetMigrations().ToArray();
                    await output.WriteLineAsync($"Compact24EFHistory=PRESENT; applied={applied.Length}; pending={runtime.Except(applied).Count()}; unknown={applied.Except(runtime).Count()}");
                }
                else await output.WriteLineAsync("Compact24EFHistory=ABSENT; existing_local_SQL_schema_is_not_automatically_adopted");
            }
            if (ready)
            {
                // Exercise actual runtime EF mapping without reading user records.
                await db.Users.AsNoTracking().Where(user => false).Select(user => user.Id).ToListAsync(token);
                await output.WriteLineAsync("RuntimeEFQuery=PASS; tenant_records_read=0");
            }
            await transaction.RollbackAsync(token);
            return ready ? 0 : 2;
        }
        catch (Exception error)
        {
            // Provider exception messages can contain credentials or sensitive server input.
            var code = error is PostgresException postgres ? postgres.SqlState : error.GetType().Name;
            await output.WriteLineAsync($"FAILED stage={stage}; code={code}; no_exception_message_logged");
            return 1;
        }
    }
}
