using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed partial class SharedConfigurationStore(Compact24DbContext db, CompactNotificationWriter sql) : ISharedConfigurationStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<T> TransactionAsync<T>(Guid[] locations, Func<Task<T>> work, CancellationToken t, bool validateActiveLocations = true)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('shared-configuration',0))", t);
        foreach (var location in locations.Distinct().Order())
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", t);
            if (validateActiveLocations && !await db.Locations.AnyAsync(l => l.Id == location && l.IsActive, t)) throw new PropertyException(409, "location_inactive_or_missing");
        }
        var value = await work(); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return value;
    }
    public async Task<SharedDocument?> GetAsync(Guid id, string resource, CancellationToken t)
    {
        var value = await sql.Scalar<string>("SELECT task_data->'document' FROM operational_tasks WHERE id=@id AND task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'resource'=@resource", t, ("id", id), ("resource", resource));
        return value is null ? null : JsonSerializer.Deserialize<SharedDocument>(value, Json);
    }
    public async Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t)
    {
        const string filter = " FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'resource'=@resource AND (@status='' OR status=@status) AND position(lower(@search) in lower(task_data->'document'->>'name'))>0";
        var total = await sql.Scalar<long>("SELECT count(*)" + filter, t, ("resource", resource), ("search", search), ("status", status));
        var items = await ReadAsync("SELECT task_data->'document'" + filter + " ORDER BY task_data->'document'->>'name',id LIMIT @limit OFFSET @offset", t,
            ("resource", resource), ("search", search), ("status", status), ("limit", pageSize), ("offset", (page - 1) * pageSize));
        return new(items, total, page, pageSize);
    }
    public Task<IReadOnlyList<SharedDocument>> FamilyAsync(Guid family, string resource, CancellationToken t) => ReadAsync("SELECT task_data->'document' FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'familyId'=@family AND task_data->'document'->>'resource'=@resource ORDER BY (task_data->'document'->>'edition')::integer", t, ("family", family.ToString()), ("resource", resource));
    public Task<IReadOnlyList<SharedDocument>> HistoryAsync(Guid id, CancellationToken t) => ReadAsync("SELECT h->'document' FROM operational_tasks CROSS JOIN LATERAL jsonb_array_elements(history) h WHERE id=@id AND task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' ORDER BY (h->'document'->>'version')::integer", t, ("id", id));
    private async Task<IReadOnlyList<SharedDocument>> ReadAsync(string query, CancellationToken t, params (string Key, object? Value)[] args)
    {
        await using var cmd = await sql.Command(query, t, args); await using var reader = await cmd.ExecuteReaderAsync(t); var items = new List<SharedDocument>();
        while (await reader.ReadAsync(t)) items.Add(JsonSerializer.Deserialize<SharedDocument>(reader.GetString(0), Json)!); return items;
    }
    public Task<bool> NameExistsAsync(string resource, string name, Guid family, CancellationToken t) => sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'resource'=@resource AND status<>'Archived' AND lower(trim(task_data->'document'->>'name'))=lower(@name) AND task_data->'document'->>'familyId'<>@family)", t, ("resource", resource), ("name", name), ("family", family.ToString()));
    public async Task SaveAsync(SharedDocument document, int expected, CancellationToken t)
    {
        var payload = JsonSerializer.Serialize(new { recordType = "SharedConfiguration", document }, Json);
        var history = JsonSerializer.Serialize(new[] { new { action = document.Status, actorId = document.UpdatedBy, occurredAt = document.UpdatedAt, document } }, Json);
        if (expected == 0)
            await sql.Execute("INSERT INTO operational_tasks(id,task_type,assigned_user_id,source_key,title,status,task_data,history,version) VALUES(@id,'COMMAND',@actor,@key,@title,@status,@payload::jsonb,@history::jsonb,1)", t,
                ("id", document.Id), ("actor", document.CreatedBy), ("key", $"shared:{document.Resource}:{document.Id:N}"), ("title", document.Name), ("status", document.Status), ("payload", payload), ("history", history));
        else if (await sql.Execute("UPDATE operational_tasks SET title=@title,status=@status,task_data=@payload::jsonb,history=history||@history::jsonb,version=version+1 WHERE id=@id AND version=@expected", t,
                ("id", document.Id), ("title", document.Name), ("status", document.Status), ("payload", payload), ("history", history), ("expected", expected)) != 1) throw new PropertyException(409, "stale_version");
    }
}
