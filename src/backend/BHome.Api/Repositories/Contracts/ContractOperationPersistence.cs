using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal static class ContractOperationPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string Key(Guid actor, string operation, Guid key) => $"{actor}/{operation}/{key}";
    private static Guid Id(string key) => new(SHA256.HashData(Encoding.UTF8.GetBytes("ContractOperation/" + key)).AsSpan(0, 16));

    internal static async Task<ContractOperation?> ReadAsync(Compact24DbContext db, Guid actor, Guid key, string operation, CancellationToken token)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value"
            FROM operational_tasks
            WHERE id={Id(Key(actor, operation, key))} AND task_type='COMMAND'
                AND task_data->>'recordType'='ContractOperation' AND COALESCE(task_data->>'deleted','false')<>'true'
            """).SingleOrDefaultAsync(token);
        return json is null ? null : JsonSerializer.Deserialize<ContractOperation>(json, Json);
    }

    internal static async Task AppendAsync(Compact24DbContext db, ContractOperation operation, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Contract command requires its existing transaction.");
        var key = Key(operation.ActorId, operation.Operation, operation.Key);
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "ContractOperation", deleted = false, state = operation }, Json);
        var history = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "ContractOperation", recordKey = key, deleted = false, state = operation }, Json);
        var source = "ContractOperation:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({Id(key)},'COMMAND',{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
            """, token);
    }
}
