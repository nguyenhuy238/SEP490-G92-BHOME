using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using System.Text.Json;

namespace BHome.Infrastructure.Persistence.Compact24;

internal enum CompactRecordKind { Root, Array, Object, History, Technical, Notification, Computed }

// SQL identifiers and expressions below are compile-time mappings. User values always use parameters.
internal sealed class CompactRecordSql(string name, string table, CompactRecordKind kind)
{
    internal string Name { get; } = name;
    internal string Table { get; } = table;
    internal CompactRecordKind Kind { get; } = kind;
    internal string Container { get; set; } = "history";
    internal string? Path { get; set; }
    internal string Parent { get; set; } = "Id";
    internal string Where { get; set; } = "TRUE";
    internal string? CustomFrom { get; set; }
    internal string? CustomState { get; set; }
    internal bool AppendOnly { get; set; }
    internal Dictionary<string, string> Read { get; } = new(StringComparer.Ordinal);
    internal Dictionary<string, string> Write { get; } = new(StringComparer.Ordinal);

    internal CompactRecordSql Map(string property, string column, string? read = null, string? write = null)
    {
        Read[property] = read ?? "t." + column;
        Write[column] = write ?? JsonValue("@state::jsonb", property);
        return this;
    }

    internal string Select(IReadOnlyEntityType entity)
    {
        var (from, state) = Source();
        return "SELECT " + string.Join(",", entity.GetProperties().Select(p =>
        {
            var value = Read.TryGetValue(p.Name, out var native) ? native : Value(state, p);
            return $"({value})::{SqlType(p)} AS \"{p.Name}\"";
        })) + " FROM " + from + " WHERE " + Where;
    }

    private (string From, string State) Source()
    {
        if (CustomFrom is not null) return (CustomFrom, CustomState ?? "'{}'::jsonb");
        var json = "t." + Container + (Path is null ? "" : "->'" + Path + "'");
        return Kind switch
        {
            CompactRecordKind.Root => ($"{Table} t LEFT JOIN LATERAL (SELECT h.value->'state' AS data FROM jsonb_array_elements(t.history) WITH ORDINALITY h(value,n) WHERE h.value->>'recordType'='{Name}' ORDER BY h.n DESC LIMIT 1) s ON TRUE", "s.data"),
            CompactRecordKind.Object => ($"{Table} t", json),
            CompactRecordKind.Array => ($"{Table} t CROSS JOIN LATERAL jsonb_array_elements(COALESCE({json},'[]'::jsonb)) e(data)", "e.data"),
            CompactRecordKind.History => ($"{Table} t CROSS JOIN LATERAL (SELECT DISTINCT ON (h.value->>'recordKey') h.value->'state' AS data, h.value->>'deleted' AS deleted FROM jsonb_array_elements({json}) WITH ORDINALITY h(value,n) WHERE h.value->>'recordType'='{Name}' ORDER BY h.value->>'recordKey',h.n DESC) s", "s.data"),
            CompactRecordKind.Technical => ($"{Table} t", "t.task_data->'state'"),
            CompactRecordKind.Notification => ($"{Table} t", "t.event_data->'state'"),
            _ => throw new InvalidOperationException("Missing Compact24 projection: " + Name)
        };
    }

    internal static string Camel(string value) => JsonNamingPolicy.CamelCase.ConvertName(value);
    internal static string JsonValue(string state, string property) => $"({state}->>'{Camel(property)}')";
    private static string Value(string state, IReadOnlyProperty property)
    {
        var type = SqlType(property);
        var value = JsonValue(state, property.Name);
        if (type.EndsWith("[]", StringComparison.Ordinal))
            value = $"(SELECT array_agg(v::text)::{type} FROM jsonb_array_elements_text({state}->'{Camel(property.Name)}') a(v))";
        else value = $"({value})::{type}";
        if (property.IsNullable) return value;
        var clr = Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType;
        var fallback = type.EndsWith("[]", StringComparison.Ordinal) ? $"ARRAY[]::{type}" :
            type == "jsonb" ? "'{}'::jsonb" : clr == typeof(string) ? "''" :
            clr == typeof(Guid) ? "'00000000-0000-0000-0000-000000000000'::uuid" :
            clr == typeof(DateOnly) ? "'0001-01-01'::date" :
            clr == typeof(DateTimeOffset) || clr == typeof(DateTime) ? "'1970-01-01Z'::timestamptz" :
            clr == typeof(bool) ? "FALSE" : "0";
        return $"COALESCE({value},{fallback})";
    }

    internal static string SqlType(IReadOnlyProperty property)
    {
        var configured = property.GetColumnType();
        if (!string.IsNullOrEmpty(configured)) return configured;
        var clr = Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType;
        if (clr.IsEnum || clr == typeof(int)) return "integer";
        if (clr == typeof(long)) return "bigint";
        if (clr == typeof(short)) return "smallint";
        if (clr == typeof(Guid)) return "uuid";
        if (clr == typeof(DateOnly)) return "date";
        if (clr == typeof(DateTimeOffset) || clr == typeof(DateTime)) return "timestamptz";
        if (clr == typeof(bool)) return "boolean";
        if (clr == typeof(decimal)) return "numeric";
        if (clr == typeof(string[])) return "text[]";
        if (clr == typeof(Guid[])) return "uuid[]";
        if (clr == typeof(string)) return "text";
        throw new InvalidOperationException("Unsupported Compact24 scalar: " + property.Name);
    }
}
