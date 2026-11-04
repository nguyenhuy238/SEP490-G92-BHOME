using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed record DevelopmentDatabaseResult(string State, string? BackupDatabase = null);
public sealed class DevelopmentDatabaseException(string code) : InvalidOperationException(
    "Compact24 Development database: " + code + ". Use scripts/Update-LocalDatabase.ps1 -Check; " +
    "for the one-time legacy replacement use -RecreateDatabase. No tables are dropped.")
{
    public string Code { get; } = code;
}

// Development only. Normal startup creates missing/empty databases, never resets existing data.
// Legacy replacement requires a separate explicit command and preserves the entire old database.
public static class Compact24DevelopmentDatabase
{
    public static async Task<DevelopmentDatabaseResult> PrepareAsync(string? environment, string connectionString,
        bool archiveLegacy = false, bool checkOnly = false, CancellationToken token = default)
    {
        var settings = ValidateTarget(environment, connectionString);
        if (archiveLegacy && checkOnly) throw new DevelopmentDatabaseException("incompatible_modes");
        try
        {
            var adminSettings = new NpgsqlConnectionStringBuilder(settings.ConnectionString) { Database = "postgres" };
            await using var admin = new NpgsqlConnection(adminSettings.ConnectionString);
            await admin.OpenAsync(token);
            // One session lock serializes competing Development startup/CLI processes.
            await using var gate = new NpgsqlCommand("SELECT pg_advisory_lock(hashtextextended(@key,0))", admin);
            gate.Parameters.AddWithValue("key", "bhome-compact24-development:" + settings.Database);
            await gate.ExecuteNonQueryAsync(token);
            if (!await ExistsAsync(admin, settings.Database!, token))
            {
                if (checkOnly) return new("MISSING");
                await ExecuteAsync(admin, "CREATE DATABASE " + Quote(settings.Database!), token);
            }
            await using var target = new NpgsqlConnection(settings.ConnectionString);
            await target.OpenAsync(token);
            var tables = await TablesAsync(target, token);
            if (tables.Length == 0)
            {
                if (checkOnly) return new("EMPTY");
                await Compact24Schema.ApplyToEmptyDatabaseAsync(target, token);
                if (!await ReadyAsync(target, token)) throw new DevelopmentDatabaseException("initialization_verification_failed");
                return new("INITIALIZED");
            }
            if (await ReadyAsync(target, token)) return new("READY");
            var legacy = tables.Order(StringComparer.Ordinal).SequenceEqual(
                Compact24MigrationMap.Tables.Keys.Append("__EFMigrationsHistory").Order(StringComparer.Ordinal));
            if (!legacy) throw new DevelopmentDatabaseException("unrecognized_existing_schema");
            if (checkOnly) return new("LEGACY_REQUIRES_RECREATE");
            if (!archiveLegacy) throw new DevelopmentDatabaseException("legacy_requires_explicit_recreate");
            await target.CloseAsync();
            return await ArchiveAndReplaceAsync(admin, settings, token);
        }
        catch (PostgresException error) { throw new DevelopmentDatabaseException("postgres_" + error.SqlState); }
        catch (NpgsqlException) { throw new DevelopmentDatabaseException("postgres_unavailable_or_invalid_credentials"); }
    }

    internal static NpgsqlConnectionStringBuilder ValidateTarget(string? environment, string connectionString)
    {
        if (environment != "Development") throw new DevelopmentDatabaseException("development_environment_required");
        NpgsqlConnectionStringBuilder settings;
        try { settings = new(connectionString); }
        catch (ArgumentException) { throw new DevelopmentDatabaseException("invalid_connection_configuration"); }
        if (settings.Host is not ("localhost" or "127.0.0.1" or "::1") ||
            settings.Database != "bhome" && !Regex.IsMatch(settings.Database ?? "", "^bhome_compact24_dev_[a-f0-9]{32}$"))
            throw new DevelopmentDatabaseException("dedicated_loopback_development_database_required");
        settings.Pooling = false;
        settings.IncludeErrorDetail = false;
        settings.ApplicationName = "BHome.Compact24.Development";
        return settings;
    }

    private static async Task<DevelopmentDatabaseResult> ArchiveAndReplaceAsync(NpgsqlConnection admin,
        NpgsqlConnectionStringBuilder settings, CancellationToken token)
    {
        var original = settings.Database!;
        var candidate = "bhome24_new_" + Guid.NewGuid().ToString("N");
        var backup = "bhome_legacy_" + DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss'Z'") + "_" + Guid.NewGuid().ToString("N")[..8];
        await ExecuteAsync(admin, "CREATE DATABASE " + Quote(candidate), token);
        var candidateSettings = new NpgsqlConnectionStringBuilder(settings.ConnectionString) { Database = candidate };
        await using (var prepared = new NpgsqlConnection(candidateSettings.ConnectionString))
        {
            await prepared.OpenAsync(token);
            await Compact24Schema.ApplyToEmptyDatabaseAsync(prepared, token);
            if (!await ReadyAsync(prepared, token)) throw new DevelopmentDatabaseException("replacement_verification_failed");
        }
        var archived = false;
        var replaced = false;
        try
        {
            await ExecuteAsync(admin, "ALTER DATABASE " + Quote(original) + " ALLOW_CONNECTIONS false", token);
            await using (var terminate = new NpgsqlCommand("SELECT pg_terminate_backend(pid,5000) FROM pg_stat_activity WHERE datname=@name AND pid<>pg_backend_pid()", admin))
            {
                terminate.Parameters.AddWithValue("name", original); await terminate.ExecuteNonQueryAsync(token);
            }
            await ExecuteAsync(admin, "ALTER DATABASE " + Quote(original) + " RENAME TO " + Quote(backup), token); archived = true;
            await ExecuteAsync(admin, "ALTER DATABASE " + Quote(candidate) + " RENAME TO " + Quote(original), token); replaced = true;
        }
        finally
        {
            // Restore connection access and the original name if the swap did not finish.
            // Do not use the cancelled request token for recovery. Preserve both databases.
            if (archived && !replaced)
                await ExecuteAsync(admin, "ALTER DATABASE " + Quote(backup) + " RENAME TO " + Quote(original), CancellationToken.None);
            await ExecuteAsync(admin, "ALTER DATABASE " + Quote(archived && replaced ? backup : original) + " ALLOW_CONNECTIONS true", CancellationToken.None);
        }
        return new("LEGACY_ARCHIVED_AND_INITIALIZED", backup);
    }

    private static string Quote(string name) => new NpgsqlCommandBuilder().QuoteIdentifier(name);
    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql, CancellationToken token)
    {
        await using var command = new NpgsqlCommand(sql, connection); await command.ExecuteNonQueryAsync(token);
    }
    private static async Task<bool> ExistsAsync(NpgsqlConnection connection, string name, CancellationToken token)
    {
        await using var command = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=@name)", connection);
        command.Parameters.AddWithValue("name", name); return (bool)(await command.ExecuteScalarAsync(token))!;
    }
    private static async Task<string[]> TablesAsync(NpgsqlConnection connection, CancellationToken token)
    {
        var tables = new List<string>();
        await using var command = new NpgsqlCommand("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) tables.Add(reader.GetString(0));
        return tables.ToArray();
    }
    private static async Task<bool> ReadyAsync(NpgsqlConnection connection, CancellationToken token)
    {
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(connection).Options);
        return await db.IsSchemaReadyAsync(token);
    }
}
