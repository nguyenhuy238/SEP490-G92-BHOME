using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Modules.Notifications;

namespace BHome.Infrastructure.Modules.PropertyManagement;

// Rechecks eligibility after a Room returns to Available. Never creates or removes physical inventory.
internal sealed class AssetTemplateSyncJob(ISetupWorkspaceStore store, CompactNotificationWriter sql,
    IBackgroundJobQueue queue) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "asset-template-sync";
    public Task EnqueueDueAsync(CancellationToken t) => queue.EnqueueAsync(new(Name, $"asset-template-sync/{sql.Now:yyyyMMddHHmm}", "{}"), t);
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        var documents = new List<SetupDocument>();
        await using (var cmd = await sql.Command("""
            SELECT task_data->'document' FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupAssetTemplate' AND status='Published'
              AND EXISTS(SELECT 1 FROM locations l WHERE l.id=location_id AND l.is_active)
            ORDER BY location_id,(history->-1->>'occurredAt')::timestamptz DESC,id
            """, t))
        {
            await using var reader = await cmd.ExecuteReaderAsync(t);
            while (await reader.ReadAsync(t)) documents.Add(JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), CompactNotificationWriter.Json)!);
        }
        foreach (var template in documents)
        {
            var results = new List<AssetSyncRoom>();
            foreach (var room in await store.RoomsAsync(template.LocationId, t))
            {
                try
                {
                    var status = await store.TransactionAsync(template.LocationId, async () =>
                    {
                        var latest = (await store.ListAsync(template.LocationId, "AssetTemplate", t)).Where(d => d.Status == "Published").OrderByDescending(d => d.RecordedAt).ThenBy(d => d.Id).FirstOrDefault();
                        var assignmentId = new Guid(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"asset-template-assignment:{room}")).AsSpan(0, 16));
                        var assignment = await store.GetAsync(assignmentId, "AssetTemplateAssignment", t);
                        var provenanceId = new Guid(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"room-provenance:{room}")).AsSpan(0, 16));
                        var provenance = await store.GetAsync(provenanceId, "RoomProvenance", t);
                        var selected = assignment?.Data.Deserialize<AssetTemplateAssignment>(CompactNotificationWriter.Json)?.TemplateId;
                        if (selected is null && provenance is null) selected = latest?.Id;
                        if (selected != template.Id) return "SkippedOtherTemplate";
                        if (!await store.EligibleRoomAsync(room, t)) return "SkippedNotEligible";
                        var id = new Guid(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"desired:{room}:{template.Id}:{template.Version}")).AsSpan(0, 16));
                        if (await store.GetAsync(id, "DesiredAssets", t) is not null) return "Applied";
                        var data = template.Data.Deserialize<AssetTemplateWrite>(CompactNotificationWriter.Json)!;
                        await store.SaveAsync(id, template.LocationId, "DesiredAssets", "PendingVerification", new DesiredAssets(template.Id, template.Version, room, data.Items, "PendingVerification"), 0, Guid.Empty, t);
                        return "Applied";
                    }, t);
                    results.Add(new(room, status));
                }
                catch (PropertyException e) { results.Add(new(room, "Failed:" + e.Code)); }
            }
            var runId = new Guid(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"sync:{template.Id}:{template.Version}")).AsSpan(0, 16));
            var run = new AssetSyncRun(template.Id, template.Version, results, runId);
            await store.TransactionAsync(template.LocationId, async () =>
            {
                var old = await store.GetAsync(runId, "AssetSyncRun", t);
                if (old is not null && JsonSerializer.Serialize(old.Data.Deserialize<AssetSyncRun>(CompactNotificationWriter.Json), CompactNotificationWriter.Json) == JsonSerializer.Serialize(run, CompactNotificationWriter.Json)) return old;
                return await store.SaveAsync(runId, template.LocationId, "AssetSyncRun", results.Any(r => r.Status.StartsWith("Failed:", StringComparison.Ordinal)) ? "PartialFailure" : "Completed", run, old?.Version ?? 0, Guid.Empty, t);
            }, t);
        }
    }
}
