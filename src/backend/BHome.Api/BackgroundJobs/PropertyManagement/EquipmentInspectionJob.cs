using BHome.Application.Jobs;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Modules.Notifications;

namespace BHome.Infrastructure.Modules.PropertyManagement;

internal sealed class EquipmentInspectionJob(CompactNotificationWriter sql, EquipmentInspectionScheduler scheduler,
    IBackgroundJobQueue queue) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "equipment-inspections";
    public Task EnqueueDueAsync(CancellationToken t) => queue.EnqueueAsync(new(Name, $"equipment-inspections/{sql.Now:yyyyMMddHHmm}", "{}"), t);
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        Guid? after = null;
        while (true)
        {
            var ids = new List<Guid>();
            await using (var command = await sql.Command("""
                SELECT task.id FROM operational_tasks task JOIN locations l ON l.id=task.location_id
                WHERE task.task_type='SYSTEM_JOB' AND task.task_data->>'recordType'='SetupEquipmentInspectionSchedule'
                    AND task.task_data->'document'->'data'->>'enabled'='true' AND l.is_active
                    AND (@after IS NULL OR task.id>@after)
                ORDER BY task.id LIMIT 100
                """, t, ("after", after)))
            await using (var reader = await command.ExecuteReaderAsync(t))
                while (await reader.ReadAsync(t)) ids.Add(reader.GetGuid(0));
            foreach (var id in ids) await scheduler.GenerateAsync(id, t);
            if (ids.Count < 100) return;
            after = ids[^1];
        }
    }
}
