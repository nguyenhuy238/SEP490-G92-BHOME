using System.Text.Json;
using System.Text;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

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
            if (validateActiveLocations)
            {
                if (!await db.Set<BHome.Domain.Locations.Location>().AsNoTracking().AnyAsync(l => l.Id == location && l.IsActive, t)) throw new PropertyException(409, "location_inactive_or_missing");
            }
        }
        var value = await work(); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return value;
    }
    public async Task<SharedDocument?> GetAsync(Guid id, string resource, CancellationToken t)
    {
        var value = await sql.Scalar<string>("SELECT task_data->'document' FROM operational_tasks WHERE id=@id AND task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'resource'=@resource", t, ("id", id), ("resource", resource));
        return value is null ? null : JsonSerializer.Deserialize<SharedDocument>(value, Json);
    }
    public async Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t, bool latestOnly = false)
    {
        const string documents = "SELECT id,status,task_data->'document' AS document FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND task_data->'document'->>'resource'=@resource";
        // Pick a representative before searching: old editions must not reappear when the current name changes.
        var source = latestOnly ? "SELECT DISTINCT ON (document->>'familyId') id,status,document FROM (" + documents + ") d WHERE (@status IN ('','Archived') OR status=@status) ORDER BY document->>'familyId', CASE WHEN status='Archived' THEN 1 ELSE 0 END, (document->>'edition')::integer DESC,id" : documents;
        var filter = " FROM (" + source + ") d WHERE (@status='' OR status=@status) AND position(lower(@search) in lower(document->>'name'))>0";
        var total = await sql.Scalar<long>("SELECT count(*)" + filter, t, ("resource", resource), ("search", search), ("status", status));
        var items = await ReadAsync("SELECT document" + filter + " ORDER BY document->>'name',id LIMIT @limit OFFSET @offset", t,
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
    public async Task<bool> NameExistsAsync(string resource, string name, Guid family, CancellationToken t, bool includeArchived = true)
    {
        // PostgreSQL lower() under the C locale does not case-fold Vietnamese letters.
        // Match the application name policy independently of the database collation.
        // The caller holds the existing shared-configuration transaction lock.
        static string NormalizeName(string value) => string.Join(' ', value.Normalize(NormalizationForm.FormC)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        var candidate = NormalizeName(name);
        await using var cmd = await sql.Command("""
            SELECT task_data->'document'->>'name' FROM operational_tasks
            WHERE task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration'
              AND task_data->'document'->>'resource'=@resource
              AND (@includeArchived OR status<>'Archived')
              AND task_data->'document'->>'familyId'<>@family
            """, t, ("resource", resource), ("family", family.ToString()), ("includeArchived", includeArchived));
        await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t))
            if (!reader.IsDBNull(0) && string.Equals(NormalizeName(reader.GetString(0)), candidate, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }
    public Task<bool> IsUsedAsync(Guid id, string resource, CancellationToken t) => sql.Scalar<bool>("""
        SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE (
          (task_type='COMMAND' AND task_data->>'recordType'='SharedConfigurationOperation' AND (
            (task_data->'operation'->>'sourceId'=@id AND task_data->'operation'->>'resource'=@resource) OR
            EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(task_data->'operation'->'sourceReferences')='array' THEN task_data->'operation'->'sourceReferences' ELSE '[]'::jsonb END) ref WHERE ref->>'id'=@id AND ref->>'kind'=@resource))) OR
          (@resource='room-type-templates' AND task_data->>'recordType'='SetupRoomDefaults' AND task_data->'document'->'data'->>'sourceId'=@id) OR
          (@resource='asset-catalog' AND task_type='COMMAND' AND task_data->>'recordType'='SharedConfiguration' AND status IN ('Published','Archived') AND EXISTS(
            SELECT 1 FROM jsonb_array_elements(CASE
              WHEN jsonb_typeof(task_data->'document'->'data'->'items')='array' THEN task_data->'document'->'data'->'items'
              WHEN jsonb_typeof(task_data->'document'->'data'->'assetItems')='array' THEN task_data->'document'->'data'->'assetItems'
              ELSE '[]'::jsonb END) item WHERE item->>'catalogId'=@id))
        ))
        """, t, ("id", id.ToString()), ("resource", resource));
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
