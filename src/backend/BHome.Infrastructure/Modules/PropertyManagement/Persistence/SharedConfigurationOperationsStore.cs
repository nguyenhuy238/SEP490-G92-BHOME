using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed partial class SharedConfigurationStore
{
    public Task<bool> LocationCodeExistsAsync(string code, Guid? exceptLocation, CancellationToken t) =>
        sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupLocationMetadata' AND lower(trim(task_data->'document'->'data'->>'code'))=lower(@code) AND location_id<>@except)", t,
            ("code", code.Trim()), ("except", exceptLocation ?? Guid.Empty));
    public Task<bool> HasApplicationAsync(Guid family, Guid location, CancellationToken t) => sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='COMMAND' AND location_id=@location AND task_data->>'recordType'='SharedConfigurationOperation' AND task_data->'operation'->>'kind'='Apply' AND task_data->'operation'->>'familyId'=@family)", t, ("location", location), ("family", family.ToString()));
    public async Task<IReadOnlyList<PolicyDto>> PoliciesAsync(Guid location, CancellationToken t)
    {
        var rows = await db.Set<BillingPolicy>().AsNoTracking().Where(p => p.LocationId == location).OrderBy(p => p.Id)
            .Select(p => new PolicyDto(p.Id, p.LocationId, p.RoomId, p.Category, p.ChargeCode, p.Name, p.Method, p.Rate, p.EffectiveFrom, p.EffectiveTo, p.Version, p.FirstUsedAt, p.RoomTypeId)).Take(1001).ToArrayAsync(t);
        if (rows.Length > 1000) throw new PropertyException(409, "configuration_copy_page_limit"); return rows;
    }
    public async Task<IReadOnlyList<PolicyDto>> SetupCopyPoliciesAsync(Guid location, CancellationToken t)
    {
        // Filter before the bounded read: per-room rent and legacy room-type pricing
        // are not copyable setup inputs, and must not exhaust the configuration limit.
        var rows = await db.Set<BillingPolicy>().AsNoTracking()
            .Where(p => p.LocationId == location && p.RoomTypeId == null && (p.RoomId == null || p.Category != ChargeCategory.Rent))
            .OrderBy(p => p.Id)
            .Select(p => new PolicyDto(p.Id, p.LocationId, p.RoomId, p.Category, p.ChargeCode, p.Name, p.Method, p.Rate,
                p.EffectiveFrom, p.EffectiveTo, p.Version, null, null)).Take(1001).ToArrayAsync(t);
        if (rows.Length > 1000) throw new PropertyException(409, "configuration_copy_page_limit"); return rows;
    }
    public async Task<SharedOperation?> OperationAsync(Guid actor, string kind, Guid key, CancellationToken t)
    {
        var value = await sql.Scalar<string>("SELECT task_data->'operation' FROM operational_tasks WHERE task_type='COMMAND' AND source_key=@key AND task_data->>'recordType'='SharedConfigurationOperation'", t, ("key", $"shared-operation:{actor:N}:{kind}:{key:N}"));
        return value is null ? null : JsonSerializer.Deserialize<SharedOperation>(value, Json);
    }
    public async Task<SharedUsage> ApplicationsAsync(Guid family, int page, int pageSize, CancellationToken t)
    {
        const string filter = " FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfigurationOperation' AND task_data->'operation'->>'kind'='Apply' AND task_data->'operation'->>'familyId'=@family";
        var total = await sql.Scalar<long>("SELECT count(*)" + filter, t, ("family", family.ToString()));
        var locations = await sql.Scalar<long>("SELECT count(DISTINCT location_id)" + filter, t, ("family", family.ToString()));
        await using var cmd = await sql.Command("SELECT task_data->'operation'" + filter + " ORDER BY id LIMIT @limit OFFSET @offset", t, ("family", family.ToString()), ("limit", pageSize), ("offset", (page - 1) * pageSize));
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
