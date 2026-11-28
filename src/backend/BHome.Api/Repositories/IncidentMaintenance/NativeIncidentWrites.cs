using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.Common;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// Only maintenance-specific physical writes are accepted here. The caller owns
// the existing command, location and room transaction locks.
internal static class NativeIncidentWrites
{
    private static readonly JsonSerializerOptions Json = IncidentSnapshots.Json;

    internal static async Task InsertInboxAsync(Compact24DbContext db, BHome.Domain.Notifications.UserNotification notice, CancellationToken token)
    {
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "UserNotification",
            state = notice,
            audienceRole = notice.AudienceRole,
            category = notice.Category,
            succeeded = (bool?)null,
            sessionId = (Guid?)null,
            targetUserId = (Guid?)null
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,recipient_user_id,location_id,event_key,notification_type,
                related_entity_type,related_entity_id,title,message,event_data,event_at,read_at,delivery_status,
                next_delivery_at,locked_until,lease_token)
            VALUES({notice.Id},'INBOX',{notice.RecipientUserId},{notice.LocationId},{notice.EventKey},{notice.Category},
                {notice.RelatedObjectType},{notice.RelatedObjectId},{notice.Title},{notice.Summary},CAST({data} AS jsonb),
                {notice.CreatedAt},{notice.ReadAt},{notice.DeliveryState},{notice.NextDeliveryAt},{notice.DeliveryLockedUntil},
                {notice.DeliveryLeaseToken})
            """, token);
    }

    internal static async Task WriteAsync(Compact24DbContext db, AuditableEntity entity, bool added,
        int? originalVersion, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Maintenance write requires its protected transaction.");
        entity.Stamp(DateTimeOffset.UtcNow, added);
        var state = IncidentSnapshots.State(entity);
        var history = IncidentSnapshots.EnvelopeJson(entity, state);
        int affected;
        switch (entity)
        {
            case IncidentReport report:
                var decision = JsonSerializer.Serialize(new
                {
                    report.Type,
                    report.Category,
                    DecidedAt = report.OwnerDecisionAt,
                    report.ResolutionNote
                }, Json);
                var severity = report.Severity == IncidentSeverity.Emergency ? "EMERGENCY" : "NORMAL";
                var summary = string.Concat(report.Description.EnumerateRunes().Take(250).Select(r => r.ToString()));
                affected = added
                    ? await db.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO incident_reports(id,location_id,room_id,asset_id,reporter_user_id,severity,summary,
                            description,status,duplicate_of_report_id,owner_decision,reported_at,resolved_at,version,history)
                        VALUES({report.Id},{report.LocationId},{report.RoomId},{report.AssetId},{report.ReporterId},{severity},
                            {summary},{report.Description},{report.Status.ToString()},{report.DuplicateOfId},CAST({decision} AS jsonb),
                            {report.CreatedAt},{report.ResolvedAt},{report.Version},jsonb_build_array(CAST({history} AS jsonb)))
                        """, token)
                    : await db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE incident_reports SET location_id={report.LocationId},room_id={report.RoomId},asset_id={report.AssetId},
                            reporter_user_id={report.ReporterId},severity={severity},summary={summary},description={report.Description},
                            status={report.Status.ToString()},duplicate_of_report_id={report.DuplicateOfId},owner_decision=CAST({decision} AS jsonb),
                            reported_at={report.CreatedAt},resolved_at={report.ResolvedAt},version={report.Version},
                            history=history||jsonb_build_array(CAST({history} AS jsonb))
                        WHERE id={report.Id} AND version={originalVersion}
                        """, token);
                break;
            case MaintenanceWorkOrder work:
                var taskData = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "MaintenanceWorkOrder", state }, Json);
                var approved = work.ApprovedAt is null ? null : work.EstimatedCost;
                affected = added
                    ? await db.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO operational_tasks(id,task_type,incident_report_id,location_id,room_id,asset_id,assigned_user_id,
                            due_at,estimated_cost,cost_approved_by_user_id,cost_approved_at,verified_by_user_id,verified_at,status,
                            assigned_at,task_data,approved_cost,version,history)
                        VALUES({work.Id},'WORK_ORDER',{work.IncidentId},{work.LocationId},{work.RoomId},{work.AssetId},{work.AssignedStaffId},
                            {work.TargetCompletionAt},{work.EstimatedCost},{work.ApprovedById},{work.ApprovedAt},{work.VerifiedById},
                            {work.VerifiedAt},{work.Status.ToString()},{work.CreatedAt},CAST({taskData} AS jsonb),{approved},{work.Version},
                            jsonb_build_array(CAST({history} AS jsonb)))
                        """, token)
                    : await db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE operational_tasks SET incident_report_id={work.IncidentId},location_id={work.LocationId},room_id={work.RoomId},
                            asset_id={work.AssetId},assigned_user_id={work.AssignedStaffId},due_at={work.TargetCompletionAt},
                            estimated_cost={work.EstimatedCost},cost_approved_by_user_id={work.ApprovedById},cost_approved_at={work.ApprovedAt},
                            verified_by_user_id={work.VerifiedById},verified_at={work.VerifiedAt},status={work.Status.ToString()},
                            assigned_at={work.CreatedAt},task_data=CAST({taskData} AS jsonb),approved_cost={approved},version={work.Version},
                            history=history||jsonb_build_array(CAST({history} AS jsonb))
                        WHERE id={work.Id} AND task_type='WORK_ORDER' AND version={originalVersion}
                        """, token);
                break;
            case IncidentActivity activity when added:
                affected = await AppendHistoryAsync(db, activity.IncidentId, activity.WorkOrderId, history, token);
                break;
            case MaintenanceHistory repair when added:
                affected = await AppendHistoryAsync(db, repair.IncidentId, repair.WorkOrderId, history, token);
                break;
            case IncidentEvidence evidence:
                affected = await AppendHistoryAsync(db, evidence.IncidentId, evidence.WorkOrderId, history, token);
                if (affected == 1 && (evidence.WorkOrderId is not null || evidence.Kind == IncidentEvidenceKind.Report))
                {
                    var data = state.GetRawText();
                    var key = evidence.Id.ToString();
                    affected = evidence.WorkOrderId is { } id
                        ? await db.Database.ExecuteSqlInterpolatedAsync($"""
                            UPDATE operational_tasks SET evidence=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence) e
                                WHERE e->>'id'<>{key}),'[]'::jsonb)||jsonb_build_array(CAST({data} AS jsonb)||jsonb_build_object('recordType','IncidentEvidence'))
                            WHERE id={id} AND task_type='WORK_ORDER'
                            """, token)
                        : await db.Database.ExecuteSqlInterpolatedAsync($"""
                            UPDATE incident_reports SET evidence=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence) e
                                WHERE e->>'id'<>{key}),'[]'::jsonb)||jsonb_build_array(CAST({data} AS jsonb)||jsonb_build_object('recordType','IncidentEvidence'))
                            WHERE id={evidence.IncidentId}
                            """, token);
                }
                break;
            case EmergencyAction emergency:
                affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE incident_reports SET history=history||jsonb_build_array(CAST({history} AS jsonb)),
                        emergency_actions=emergency_actions||jsonb_build_array(CAST({history} AS jsonb))
                    WHERE id={emergency.IncidentId}
                    """, token);
                break;
            case MaintenanceExpense expense when added:
                var sourceKey = expense.SourceType + ":" + expense.SourceId;
                affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO expenses(id,incident_report_id,location_id,room_id,asset_id,task_id,expense_type,category,amount,
                        occurred_on,recorded_by_user_id,note,source_key,history)
                    VALUES({expense.Id},{expense.IncidentId},{expense.LocationId},{expense.RoomId},{expense.AssetId},{expense.WorkOrderId},
                        'OPERATING',{expense.Category},{expense.Amount},{expense.ExpenseDate},{expense.ConfirmedById},
                        'Owner-confirmed maintenance expense',{sourceKey},jsonb_build_array(CAST({history} AS jsonb)))
                    """, token);
                break;
            case MaintenanceCompensation compensation:
                // A database trigger also verifies exclusive invoice/deposit, scope,
                // immutable fields, previous status and consecutive version.
                affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE operational_tasks SET history=history||jsonb_build_array(CAST({history} AS jsonb))
                    WHERE id={compensation.WorkOrderId} AND task_type='WORK_ORDER'
                        AND (SELECT (h->'state'->>'version')::int FROM jsonb_array_elements(history) WITH ORDINALITY a(h,n)
                            WHERE h->>'recordType'='MaintenanceCompensation' ORDER BY n DESC LIMIT 1)
                            IS NOT DISTINCT FROM {originalVersion}
                    """, token);
                break;
            case IncidentCommand command when added:
                affected = await WriteTechnicalAsync(db, command, state, history, true, token);
                break;
            case FastRepairPolicy policy:
                affected = await WriteTechnicalAsync(db, policy, state, history, false, token);
                break;
            case IncidentFileUpload upload when added:
                affected = await WriteTechnicalAsync(db, upload, state, history, false, token);
                break;
            case IncidentNotification notice when added:
                var eventData = JsonSerializer.Serialize(new
                {
                    schemaVersion = 1,
                    recordType = "IncidentNotification",
                    state,
                    audienceRole = (string?)null,
                    category = (string?)null,
                    succeeded = (bool?)null,
                    sessionId = (Guid?)null,
                    targetUserId = (Guid?)null
                }, Json);
                affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
                    VALUES({notice.Id},'OUTBOX',{"IncidentNotification:" + notice.Id},'IncidentNotification',
                        CAST({eventData} AS jsonb),{notice.CreatedAt})
                    """, token);
                break;
            case IncidentNotification notice:
                affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE notifications SET read_at={notice.ReadAt},delivery_status={notice.DeliveryState},
                        delivery_history=delivery_history||jsonb_build_array(CAST({history} AS jsonb))
                    WHERE id={notice.Id} AND record_kind='OUTBOX' AND event_data->>'recordType'='IncidentNotification'
                    """, token);
                break;
            default:
                throw new InvalidOperationException("Unsupported maintenance write.");
        }
        if (affected != 1) throw new DbUpdateConcurrencyException("Maintenance state changed or parent no longer exists.");
    }

    internal static async Task DeleteUploadIntentAsync(Compact24DbContext db, IncidentFileUpload upload, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Cleanup requires its location transaction.");
        var state = IncidentSnapshots.State(upload);
        var history = IncidentSnapshots.EnvelopeJson(upload, state, deleted: true);
        var taskData = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "IncidentFileUpload", deleted = true, state }, Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET task_data=CAST({taskData} AS jsonb),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={upload.Id} AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='IncidentFileUpload'
                AND COALESCE(task_data->>'deleted','false')<>'true'
            """, token);
        if (changed != 1) throw new DbUpdateConcurrencyException("Upload cleanup intent no longer exists.");
    }

    private static Task<int> AppendHistoryAsync(Compact24DbContext db, Guid? incident, Guid? work, string history, CancellationToken token) =>
        incident is { } id
            ? db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE incident_reports SET history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={id}
                """, token)
            : db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET history=history||jsonb_build_array(CAST({history} AS jsonb))
                WHERE id={work} AND task_type='WORK_ORDER'
                """, token);

    private static Task<int> WriteTechnicalAsync(Compact24DbContext db, AuditableEntity row, JsonElement state,
        string history, bool command, CancellationToken token)
    {
        var kind = row.GetType().Name;
        var key = kind + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(row.Id.ToString())));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, deleted = false, state }, Json);
        return command
            ? db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
                VALUES({row.Id},'COMMAND',{key},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
                """, token)
            : db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
                VALUES({row.Id},'SYSTEM_JOB',{key},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
                ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
                """, token);
    }
}
