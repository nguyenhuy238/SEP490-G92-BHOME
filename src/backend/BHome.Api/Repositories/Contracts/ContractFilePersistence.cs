using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal static class ContractFilePersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static Guid Id(string key) => new(SHA256.HashData(Encoding.UTF8.GetBytes("ContractFileUpload/" + key)).AsSpan(0, 16));

    internal static async Task<ContractFileUpload?> FindAsync(Compact24DbContext db, string key, CancellationToken t)
    {
        var state = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE id={Id(key)} AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='ContractFileUpload'
                AND COALESCE(task_data->>'deleted','false')<>'true'
            """).SingleOrDefaultAsync(t);
        return state is null ? null : JsonSerializer.Deserialize<ContractFileUpload>(state, Json);
    }

    internal static async Task<ContractFileUpload[]> DueAsync(Compact24DbContext db, DateTimeOffset now, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='ContractFileUpload'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND (task_data->'state'->>'cleanupAfter')::timestamptz<={now}
            ORDER BY (task_data->'state'->>'cleanupAfter')::timestamptz LIMIT 100
            """).ToArrayAsync(t);
        return rows.Select(row => JsonSerializer.Deserialize<ContractFileUpload>(row, Json)
            ?? throw new InvalidOperationException("Invalid contract upload intent.")).ToArray();
    }

    internal static async Task WriteAsync(Compact24DbContext db, ContractFileUpload upload, bool deleted, CancellationToken t)
    {
        var key = upload.ObjectKey;
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "ContractFileUpload", deleted, state = upload }, Json);
        var history = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "ContractFileUpload", recordKey = key, deleted, state = upload }, Json);
        var source = "ContractFileUpload:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({Id(key)},'SYSTEM_JOB',{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
            """, t);
    }

    internal static Task<bool> LinkedAsync(Compact24DbContext db, string key, CancellationToken t) =>
        db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM contract_signings WHERE prepared_object_key={key} OR signed_object_key={key})
                OR EXISTS (SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.move_out->'evidence','[]'::jsonb)) e
                    WHERE e->>'objectKey'={key})
                OR EXISTS (SELECT 1 FROM contracts c CROSS JOIN LATERAL (
                    SELECT h.value->'state' state FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='Contract' ORDER BY h.n DESC LIMIT 1
                ) s WHERE s.state->>'signingMode'='INTERNAL_OTP_DRAWN' AND strpos(s.state->>'internalAcceptance',{key})>0)
                AS "Value"
            """).SingleAsync(t);
}
