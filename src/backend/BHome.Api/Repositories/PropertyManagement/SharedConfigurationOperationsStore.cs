using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed partial class SharedConfigurationStore
{
    public Task<bool> LocationCodeExistsAsync(string code, Guid? exceptLocation, CancellationToken t) =>
        sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupLocationMetadata' AND lower(trim(task_data->'document'->'data'->>'code'))=lower(@code) AND location_id<>@except)", t,
            ("code", code.Trim()), ("except", exceptLocation ?? Guid.Empty));
    public Task<bool> HasApplicationAsync(Guid family, Guid location, CancellationToken t) => sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='COMMAND' AND location_id=@location AND task_data->>'recordType'='SharedConfigurationOperation' AND task_data->'operation'->>'kind'='Apply' AND task_data->'operation'->>'familyId'=@family)", t, ("location", location), ("family", family.ToString()));
    public async Task<IReadOnlyList<PolicyDto>> PoliciesAsync(Guid location, CancellationToken t)
    {
        var rows = await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().Where(p => p.LocationId == location)
            .OrderBy(p => p.Id).Take(1001).ToArrayAsync(t);
        if (rows.Length > 1000) throw new PropertyException(409, "configuration_copy_page_limit");
        return rows.Select(p => PolicyView(p, false)).ToArray();
    }
    public async Task<IReadOnlyList<PolicyDto>> SetupCopyPoliciesAsync(Guid location, CancellationToken t)
    {
        // Filter before the bounded read: per-room rent and legacy room-type pricing
        // are not copyable setup inputs, and must not exhaust the configuration limit.
        var rows = await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().FromSqlInterpolated($"""
            SELECT p.* FROM billing_policies p
            LEFT JOIN LATERAL (
                SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
            ) s ON TRUE
            WHERE p.location_id={location} AND (s.data->>'roomTypeId')::uuid IS NULL
              AND (p.room_id IS NULL OR p.category<>{(short)ChargeCategory.Rent})
            """).AsNoTracking().OrderBy(p => p.Id).Take(1001).ToArrayAsync(t);
        if (rows.Length > 1000) throw new PropertyException(409, "configuration_copy_page_limit");
        return rows.Select(p => PolicyView(p, true)).ToArray();
    }
    private static PolicyDto PolicyView(BHome.Domain.PropertyManagement.BillingPolicy policy, bool forSetup)
    {
        // Name and retired room-type scope are stored in the last typed history entry.
        var state = policy.History.EnumerateArray().Reverse().FirstOrDefault(h =>
            h.ValueKind == JsonValueKind.Object && h.TryGetProperty("recordType", out var kind) &&
            kind.ValueKind == JsonValueKind.String && kind.GetString() == "BillingPolicy");
        var data = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("state", out var value)
            ? value : default;
        var name = data.ValueKind == JsonValueKind.Object && data.TryGetProperty("name", out var n) &&
            n.ValueKind != JsonValueKind.Null ? n.ValueKind == JsonValueKind.String ? n.GetString()! : n.GetRawText() : "";
        Guid? roomType = !forSetup && data.ValueKind == JsonValueKind.Object &&
            data.TryGetProperty("roomTypeId", out var r) && r.ValueKind == JsonValueKind.String
            ? r.GetGuid() : null;
        return new(policy.Id, policy.LocationId, policy.RoomId, policy.Category, policy.ChargeCode,
            name, policy.Method, policy.Rate, policy.EffectiveFrom, policy.EffectiveTo, policy.Version,
            forSetup ? null : policy.FirstUsedAt, roomType, null);
    }
    public async Task<SharedOperation?> OperationAsync(Guid actor, string kind, Guid key, CancellationToken t)
    {
        var value = await sql.Scalar<string>("SELECT task_data->'operation' FROM operational_tasks WHERE task_type='COMMAND' AND source_key=@key AND task_data->>'recordType'='SharedConfigurationOperation'", t, ("key", $"shared-operation:{actor:N}:{kind}:{key:N}"));
        return value is null ? null : JsonSerializer.Deserialize<SharedOperation>(value, Json);
    }
    public async Task<SharedUsage> ApplicationsAsync(Guid family, int page, int pageSize, CancellationToken t)
    {
        // Setup operations capture every source reference rather than a single shared family.
        // Project their exact committed references into family usage without altering the operation.
        const string usage = """
            WITH family_documents AS (
                SELECT task_data->'document' AS document FROM operational_tasks
                WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration'
                    AND task_data->'document'->>'familyId'=@family
            ), operations AS (
                SELECT id, location_id, task_data->'operation' AS operation FROM operational_tasks
                WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfigurationOperation'
            ), usage AS (
                SELECT id, location_id, operation FROM operations
                WHERE operation->>'kind'='Apply' AND operation->>'familyId'=@family
                UNION ALL
                SELECT o.id, o.location_id, o.operation || jsonb_build_object(
                    'sourceId', ref->'id', 'sourceVersion', ref->'version',
                    'sourceEdition', d.document->'edition', 'familyId', d.document->'familyId',
                    'resource', d.document->'resource')
                FROM operations o
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.operation->'sourceReferences')='array'
                    THEN o.operation->'sourceReferences' ELSE '[]'::jsonb END) ref
                JOIN family_documents d ON d.document->>'id'=ref->>'id' AND d.document->>'resource'=ref->>'kind'
                WHERE o.operation->>'kind'='LocationSetup'
            )
            """;
        var total = await sql.Scalar<long>(usage + " SELECT count(*) FROM usage", t, ("family", family.ToString()));
        var locations = await sql.Scalar<long>(usage + " SELECT count(DISTINCT location_id) FROM usage", t, ("family", family.ToString()));
        await using var cmd = await sql.Command(usage + " SELECT operation FROM usage ORDER BY id,operation->>'sourceId',operation->>'sourceVersion' LIMIT @limit OFFSET @offset", t, ("family", family.ToString()), ("limit", pageSize), ("offset", (page - 1) * pageSize));
        await using var reader = await cmd.ExecuteReaderAsync(t); var items = new List<SharedOperation>();
        while (await reader.ReadAsync(t)) items.Add(JsonSerializer.Deserialize<SharedOperation>(reader.GetString(0), Json)!);
        return new(items, total, locations, page, pageSize);
    }
    public Task SaveOperationAsync(SharedOperation operation, CancellationToken t)
    {
        var json = JsonSerializer.Serialize(new { recordType = "SharedConfigurationOperation", operation }, Json);
        var history = JsonSerializer.Serialize(new[] { new { action = operation.Kind, actorId = operation.ActorId, occurredAt = operation.AppliedAt, operation } }, Json);
        return sql.Execute("INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,source_key,title,status,task_data,history,version) VALUES(@id,'COMMAND',@location,@actor,@key,@title,'Completed',@json::jsonb,@history::jsonb,1)", t,
            ("id", operation.Id), ("location", operation.TargetLocationId), ("actor", operation.ActorId), ("key", $"shared-operation:{operation.ActorId:N}:{operation.Kind}:{operation.Key:N}"), ("title", operation.Kind + " configuration"), ("json", json), ("history", history));
    }
}
