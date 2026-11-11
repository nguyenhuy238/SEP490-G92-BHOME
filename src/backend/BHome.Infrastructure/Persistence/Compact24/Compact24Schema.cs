using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public static class Compact24Schema
{
    public const string Version = "compact24-2026-11-11-receipt-excess";
    private static readonly string Script = ReadScript();
    public static string ScriptSha256 { get; } = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Script)));
    private static readonly string[] Tables = Regex.Matches(Script, @"(?m)^CREATE TABLE ([a-z_]+)").Select(m => m.Groups[1].Value).Order(StringComparer.Ordinal).ToArray();

    // Offline import targets have their own strict name guard. Development startup uses
    // Compact24DevelopmentDatabase; neither path applies the legacy EF migrations.
    public static async Task InitializeAsync(string connectionString, CancellationToken token = default)
    {
        var settings = new NpgsqlConnectionStringBuilder(connectionString);
        if (settings.Host is not ("127.0.0.1" or "localhost" or "::1") ||
            !Regex.IsMatch(settings.Database ?? "", "^bhome_compact24_[a-f0-9]{32}$"))
            throw new Compact24MigrationException("dedicated_target_database_required");
        await using var connection = new NpgsqlConnection(connectionString); await connection.OpenAsync(token);
        await ApplyToEmptyDatabaseAsync(connection, token);
    }

    internal static async Task ApplyToEmptyDatabaseAsync(NpgsqlConnection connection, CancellationToken token)
    {
        // The caller validates its environment/target. DDL itself refuses a populated schema.
        await using var command = new NpgsqlCommand(Script, connection); await command.ExecuteNonQueryAsync(token);
    }

    internal static async Task<bool> VerifyAsync(Compact24DbContext db, CancellationToken token)
    {
        if (!await VerifyReferenceAsync(db, Script, token)) return false;
        return await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass
              AND conname='ck_contract_active_metadata' AND convalidated AND pg_get_constraintdef(oid) NOT LIKE '%tenant_user_id%')
              AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_residents'::regclass
              AND conname='ck_resident_actual_dates' AND convalidated
              AND pg_get_constraintdef(oid) LIKE '%actual_residence_from IS NULL%') AS "Value"
            """).SingleAsync(token);
    }
    internal static Task<bool> VerifyPreviousPropertyAsync(Compact24DbContext db, CancellationToken token) =>
        VerifyReferenceAsync(db, PreviousPropertyReference, token);
    internal static string PreviousPropertyReference { get; } = ReadScript("BHome.Compact24.PreviousProperty.schema-reference");

    // These profiles are used only for SELECT-based verification, never executed as SQL.
    private static async Task<bool> VerifyReferenceAsync(Compact24DbContext db, string reference, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction();
        var columns = new List<string>();
        await using (var query = new NpgsqlCommand("""
            SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
            WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum
            """, connection, transaction))
        {
            await using var reader = await query.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) columns.Add($"{reader.GetString(0)}.{reader.GetString(1)}:{reader.GetString(2)}:{reader.GetBoolean(3)}");
        }
        var expected = ExpectedColumns(reference);
        if (columns.Count != expected.Length || !columns.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)) ||
            !columns.Select(c => c.Split('.')[0]).Distinct().Order(StringComparer.Ordinal).SequenceEqual(Tables)) return false;
        var foreignKeys = new List<string>();
        await using (var query = new NpgsqlCommand("""
            SELECT origin.relname,
              array_to_string(ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(id,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.id ORDER BY k.n),','),
              destination.relname,
              array_to_string(ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(id,n) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.id ORDER BY k.n),',')
            FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class origin ON origin.oid=c.conrelid
              JOIN pg_class destination ON destination.oid=c.confrelid WHERE n.nspname='public' AND c.contype='f'
            """, connection, transaction))
        {
            await using var reader = await query.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) foreignKeys.Add($"{reader.GetString(0)}({reader.GetString(1)})->{reader.GetString(2)}({reader.GetString(3)})");
        }
        if (!foreignKeys.Order(StringComparer.Ordinal).SequenceEqual(ExpectedForeignKeys(reference).Order(StringComparer.Ordinal))) return false;
        // Verify the original append-only/invoice/payment/refresh protections, including their bodies.
        foreach (Match function in Regex.Matches(reference, @"CREATE FUNCTION ([a-z0-9_]+)\([^$]+?AS \$fn\$([\s\S]*?)\$fn\$;"))
        {
            await using var query = new NpgsqlCommand("SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=@name", connection, transaction);
            query.Parameters.AddWithValue("name", function.Groups[1].Value);
            var actual = (string?)await query.ExecuteScalarAsync(token);
            if (actual?.Replace("\r\n", "\n", StringComparison.Ordinal).Trim() != function.Groups[2].Value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim()) return false;
        }
        var requiredTriggers = Regex.Matches(reference, @"(?m)^CREATE TRIGGER ([a-z0-9_]+)").Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);
        await using (var query = new NpgsqlCommand("SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O'", connection, transaction))
        {
            await using var reader = await query.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) requiredTriggers.Remove(reader.GetString(0));
        }
        if (requiredTriggers.Count != 0) return false;
        var requiredIndexes = Regex.Matches(reference, @"(?m)^CREATE (?:UNIQUE )?INDEX ([a-z0-9_]+)").Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);
        await using (var query = new NpgsqlCommand("SELECT indexname FROM pg_indexes WHERE schemaname='public'", connection, transaction))
        {
            await using var reader = await query.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) requiredIndexes.Remove(reader.GetString(0));
        }
        if (requiredIndexes.Count != 0) return false;
        await using (var query = new NpgsqlCommand("""
            SELECT count(*)=24 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname='no_business_truncate' AND t.tgenabled='O'
            """, connection, transaction))
            return (bool)(await query.ExecuteScalarAsync(token))!;
    }

    internal static string[] ExpectedColumns(string reference)
    {
        var columns = new List<string>();
        foreach (Match table in Regex.Matches(reference, @"(?m)^CREATE TABLE ([a-z_]+) \(([\s\S]*?)^\);"))
            foreach (Match column in Regex.Matches(table.Groups[2].Value, @"(?m)^    ([a-z_]+) ([a-z]+(?:\([0-9,]+\))?(?:\[\])?)([^\r\n]*)"))
            {
                var type = column.Groups[2].Value.Replace("varchar", "character varying", StringComparison.Ordinal)
                    .Replace("timestamptz", "timestamp with time zone", StringComparison.Ordinal);
                var required = column.Groups[3].Value.Contains("NOT NULL", StringComparison.Ordinal) || column.Groups[3].Value.Contains("PRIMARY KEY", StringComparison.Ordinal);
                columns.Add($"{table.Groups[1].Value}.{column.Groups[1].Value}:{type}:{required}");
            }
        return columns.ToArray();
    }

    private static string[] ExpectedForeignKeys(string reference)
    {
        var keys = new List<string>();
        foreach (Match table in Regex.Matches(reference, @"(?m)^CREATE TABLE ([a-z_]+) \(([\s\S]*?)^\);"))
        {
            foreach (Match column in Regex.Matches(table.Groups[2].Value, @"(?m)^    ([a-z_]+) [^\r\n]*?REFERENCES ([a-z_]+)\(([a-z_,]+)\)"))
                keys.Add($"{table.Groups[1].Value}({column.Groups[1].Value})->{column.Groups[2].Value}({column.Groups[3].Value})");
            foreach (Match composite in Regex.Matches(table.Groups[2].Value, @"FOREIGN KEY\(([a-z_,]+)\) REFERENCES ([a-z_]+)\(([a-z_,]+)\)"))
                keys.Add($"{table.Groups[1].Value}({composite.Groups[1].Value})->{composite.Groups[2].Value}({composite.Groups[3].Value})");
        }
        foreach (Match alter in Regex.Matches(reference, @"ALTER TABLE ([a-z_]+) ADD CONSTRAINT [a-z_]+ FOREIGN KEY\(([a-z_,]+)\) REFERENCES ([a-z_]+)\(([a-z_,]+)\)"))
            keys.Add($"{alter.Groups[1].Value}({alter.Groups[2].Value})->{alter.Groups[3].Value}({alter.Groups[4].Value})");
        return keys.ToArray();
    }

    private static string ReadScript(string resource = "BHome.Compact24.Schema.sql")
    {
        using var stream = typeof(Compact24Schema).Assembly.GetManifestResourceStream(resource)!;
        using var reader = new StreamReader(stream); return reader.ReadToEnd();
    }
}
