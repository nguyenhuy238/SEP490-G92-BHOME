using BHome.Application.Operations;
using BHome.Infrastructure.Modules.Notifications;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class LifecycleAttentionRepository(CompactNotificationWriter sql) : ILifecycleAttentionRepository
{
    public async Task<LifecycleAttentionView> ReadAsync(DateOnly today, CancellationToken t)
    {
        await using var command = await sql.Command("""
            SELECT
              (SELECT count(*) FROM operational_tasks task JOIN assets a ON a.id::text=task.task_data->'document'->'data'->>'assetId'
                WHERE task.task_type='SYSTEM_JOB' AND task.task_data->>'recordType'='SetupAssetEquipmentUnit' AND task.status='Unsafe' AND a.status<>3),
              (SELECT count(*) FROM operational_tasks task WHERE task.task_type='SYSTEM_JOB' AND task.task_data->>'recordType'='SetupLocationLegalRecord'
                AND task.status='Active' AND task.task_data->'document'->'data'->'details'->>'expiresOn' < @today),
              (SELECT count(*) FROM operational_tasks task WHERE task.task_type='SYSTEM_JOB' AND task.task_data->>'recordType'='SetupTaxObligation'
                AND task.status IN ('Pending','InProgress') AND task.task_data->'document'->'data'->'details'->>'deadline' < @today),
              (SELECT count(*) FROM users u CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.business_profile->'personalDataRequests','[]'::jsonb)) r
                WHERE r->>'status' IN ('Pending','InReview'))
            """, t, ("today", today.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)));
        await using var reader = await command.ExecuteReaderAsync(t); await reader.ReadAsync(t);
        return new(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3));
    }
}
