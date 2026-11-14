using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public static class Compact24PropertyUpgrade
{
    // Explicit Development operation, never executed by normal API startup.
    public static async Task<DevelopmentDatabaseResult> ApplyAsync(string? environment, string connectionString,
        CancellationToken token = default)
    {
        var settings = Compact24DevelopmentDatabase.ValidateTarget(environment, connectionString);
        try
        {
            await using var connection = new NpgsqlConnection(settings.ConnectionString);
            await connection.OpenAsync(token);
            await using var tx = await connection.BeginTransactionAsync(token);
            await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(connection).Options);
            await db.Database.UseTransactionAsync(tx, token);
            await using (var gate = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('compact24-property-upgrade',0))", connection, tx))
                await gate.ExecuteNonQueryAsync(token);
            if (await db.IsSchemaReadyAsync(token)) return new("READY");
            if (!await Compact24Schema.CanRefreshPropertyAsync(db, token))
                throw new DevelopmentDatabaseException("property_upgrade_source_requires_manual_review");
            await using (var shape = new NpgsqlCommand("SELECT set_config('bhome.property_upgrade_column_count',@columns,true)", connection, tx))
            {
                shape.Parameters.AddWithValue("columns", Compact24Schema.CurrentColumnCount.ToString(System.Globalization.CultureInfo.InvariantCulture));
                await shape.ExecuteNonQueryAsync(token);
            }
            await using var stream = typeof(Compact24Schema).Assembly.GetManifestResourceStream("BHome.Compact24.PropertyUpgrade.sql")!;
            using var reader = new StreamReader(stream);
            await using var command = new NpgsqlCommand(await reader.ReadToEndAsync(token), connection, tx);
            await command.ExecuteNonQueryAsync(token);
            if (!await db.IsSchemaReadyAsync(token)) throw new DevelopmentDatabaseException("property_upgrade_verification_failed");
            await tx.CommitAsync(token);
            return new("UPGRADED");
        }
        catch (PostgresException error) { throw new DevelopmentDatabaseException("property_upgrade_rejected_" + error.SqlState); }
        catch (NpgsqlException) { throw new DevelopmentDatabaseException("postgres_unavailable_or_invalid_credentials"); }
    }
}
