using Npgsql;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>
/// Direct PostgreSQL access for the plan steps that say "Query ... in DB" or "In PostgreSQL: UPDATE ...".
/// Table and column names are the ones written in the plan. Skips when BHOME_IT_DB is not set.
/// </summary>
public static class PlanDb
{
    public static async Task<NpgsqlConnection> OpenAsync()
    {
        var cs = PlanSettings.Current.Database;
        Skip.If(cs is null, "This test case checks the database. Set BHOME_IT_DB to the Npgsql connection string of the API database.");
        var connection = new NpgsqlConnection(cs);
        await connection.OpenAsync();
        return connection;
    }

    public static async Task<object?> ScalarAsync(string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await OpenAsync();
        await using var command = Command(connection, sql, parameters);
        var value = await command.ExecuteScalarAsync();
        return value is DBNull ? null : value;
    }

    public static async Task<int> ExecuteAsync(string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await OpenAsync();
        await using var command = Command(connection, sql, parameters);
        return await command.ExecuteNonQueryAsync();
    }

    /// <summary>Rows as dictionaries (column name → value) for checks such as "session record is persisted".</summary>
    public static async Task<IReadOnlyList<Dictionary<string, object?>>> RowsAsync(string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await OpenAsync();
        await using var command = Command(connection, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    /// <summary>
    /// Fails with a clear message when a table named in the plan does not exist in the database
    /// (the plan may still use old ASP.NET Identity names such as "AspNetUsers").
    /// </summary>
    public static async Task RequirePlanTableAsync(string table)
    {
        var exists = await ScalarAsync(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = @t)",
            ("t", table));
        Assert.True(
            exists is true,
            $"The plan checks table \"{table}\", but the database has no such table. Update the plan to the current schema or fix the database.");
    }

    /// <summary>
    /// Counts rows of a plan table whose text form contains <paramref name="value"/> (e.g. a sessionId or an email),
    /// so the check does not depend on column names that the plan does not state.
    /// </summary>
    public static async Task<long> CountRowsMentioningAsync(string table, string value)
    {
        await RequirePlanTableAsync(table);
        var count = await ScalarAsync(
            $"SELECT COUNT(*) FROM \"{table.Replace("\"", string.Empty)}\" t WHERE position(lower(@v) in lower(t::text)) > 0",
            ("v", value));
        return Convert.ToInt64(count);
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, (string Name, object? Value)[] parameters)
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }

        return command;
    }
}
