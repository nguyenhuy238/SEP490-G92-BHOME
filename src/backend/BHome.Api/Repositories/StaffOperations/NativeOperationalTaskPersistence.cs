using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.Common;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.StaffOperations.Persistence;

// The JSON records retain their existing persisted keys and explicit typed shapes.
internal static class NativeOperationalTaskPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static IQueryable<BHome.Domain.Billing.OperationalTask> Roots(Compact24DbContext db) =>
        db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(x => x.TaskType == "GENERAL" || x.TaskType == "METER_READ");

    internal static async Task<OperationalTask?> FindAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var row = await Roots(db).SingleOrDefaultAsync(x => x.Id == id, t);
        return row is null ? null : NativeCaptureReads.Task(row);
    }

    internal static Task<Guid[]> EligibleStaffAsync(Compact24DbContext db, DateOnly date, CancellationToken t) =>
        StaffEmploymentEligibility.EligibleIds(db, date).ToArrayAsync(t);

    internal sealed record AssignmentRow(Guid LocationId, Guid AssignmentId, Guid StaffUserId, bool IsActive);
    internal static IQueryable<AssignmentRow> Assignments(Compact24DbContext db, DateOnly date) =>
        db.Database.SqlQuery<AssignmentRow>($"""
            SELECT l.id AS "LocationId",(a->>'id')::uuid AS "AssignmentId",
                (a->>'staffUserId')::uuid AS "StaffUserId",l.is_active AS "IsActive"
            FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            WHERE (a->>'startDate')::date<={date} AND (a->>'endDate')::date>={date}
            """).Where(a => StaffEmploymentEligibility.EligibleIds(db, date).Contains(a.StaffUserId));

    internal static IQueryable<BHome.Domain.Billing.OperationalTask> Visible(Compact24DbContext db, Guid? staffId, DateOnly date)
    {
        var rows = Roots(db);
        if (staffId is { } staff)
        {
            var allowed = Assignments(db, date).Where(a => a.IsActive && a.StaffUserId == staff).Select(a => a.LocationId);
            rows = rows.Where(x => x.LocationId != null && allowed.Contains(x.LocationId.Value));
        }
        return rows;
    }

    internal sealed record ListKey(Guid Id, Guid? Responsible, DateTimeOffset? DueAt, DateTimeOffset CreatedAt, int Status);
    internal static async Task<TaskPage<TaskView>> ListAsync(Compact24DbContext db, TaskQuery query, Guid? staffId,
        DateOnly date, DateTimeOffset now, CancellationToken t)
    {
        var eligible = await EligibleStaffAsync(db, date, t);
        var category = (int?)query.Category;
        var status = query.Status is { } s ? ((int)s).ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
        var priority = query.Priority is { } p ? ((int)p).ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
        var search = string.IsNullOrWhiteSpace(query.Search) ? null : query.Search.Trim().ToLower();
        var rows = db.Database.SqlQuery<ListKey>($"""
            SELECT o.id AS "Id", CASE WHEN k.kind=1 AND o.contract_id IS NOT NULL AND o.title LIKE 'Kiểm tra trả phòng%'
                THEN CASE WHEN o.status='0' THEN CASE WHEN CAST({staffId} AS uuid) IS NOT NULL
                    AND NOT EXISTS(SELECT 1 FROM contracts c WHERE c.id=o.contract_id
                        AND c.move_out->'current'->>'inspectionStaffId' IS NOT NULL
                        AND (c.move_out->'current'->>'inspectionStaffId')::uuid<>CAST({staffId} AS uuid))
                    THEN CAST({staffId} AS uuid) END ELSE o.assigned_user_id END
                ELSE a.staff_id END AS "Responsible",
                o.due_at AS "DueAt",COALESCE((d.state->>'createdAt')::timestamptz,'1970-01-01T00:00:00Z') AS "CreatedAt",
                o.status::int AS "Status"
            FROM operational_tasks o JOIN locations l ON l.id=o.location_id
            CROSS JOIN LATERAL (SELECT o.task_data->'state' AS state) d
            CROSS JOIN LATERAL (SELECT CASE WHEN (d.state->>'kind')::int IN (2,3) THEN (d.state->>'kind')::int ELSE 1 END AS kind) k
            LEFT JOIN LATERAL (
                SELECT (v->>'staffUserId')::uuid AS staff_id,(v->>'id')::uuid AS assignment_id
                FROM jsonb_array_elements(l.staff_assignments) v
                WHERE l.is_active AND (v->>'startDate')::date<={date} AND (v->>'endDate')::date>={date}
                    AND (v->>'staffUserId')::uuid=ANY({eligible})
            ) a ON true
            WHERE o.task_type='GENERAL'
                AND (CAST({staffId} AS uuid) IS NULL OR
                    (a.staff_id=CAST({staffId} AS uuid)
                    AND (k.kind<>3 OR a.assignment_id=(d.state->>'assignmentId')::uuid)
                    AND (k.kind<>2 OR o.contract_id IS NULL OR NOT EXISTS(
                        SELECT 1 FROM operational_tasks m WHERE m.task_type='GENERAL' AND m.contract_id=o.contract_id
                            AND COALESCE((m.task_data->'state'->>'kind')::int,1) NOT IN (2,3)
                            AND m.title LIKE 'Bàn giao vào phòng%'))))
                AND (CAST({query.LocationId} AS uuid) IS NULL OR o.location_id=CAST({query.LocationId} AS uuid))
                AND (CAST({query.RoomId} AS uuid) IS NULL OR (d.state->>'targetRoomId')::uuid=CAST({query.RoomId} AS uuid))
                AND (NOT {query.ActionableOnly} OR o.status IN ('0','1'))
                AND (CAST({category} AS int) IS NULL OR CASE CAST({category} AS int)
                    WHEN 1 THEN k.kind=1 AND o.contract_id IS NOT NULL AND o.title LIKE 'Bàn giao vào phòng%'
                    WHEN 2 THEN k.kind=1 AND o.contract_id IS NOT NULL AND o.title LIKE 'Kiểm tra trả phòng%'
                    ELSE NOT (o.contract_id IS NOT NULL AND (k.kind=2 OR (k.kind=1 AND
                        (o.title LIKE 'Bàn giao vào phòng%' OR o.title LIKE 'Kiểm tra trả phòng%')))) END)
                AND (CAST({search} AS text) IS NULL OR strpos(lower(o.title),CAST({search} AS text))>0
                    OR strpos(lower(d.state->>'targetLabel'),CAST({search} AS text))>0)
                AND (CAST({query.RecordedStaffUserId} AS uuid) IS NULL OR o.assigned_user_id=CAST({query.RecordedStaffUserId} AS uuid))
                AND (CAST({query.HasResponsibility} AS boolean) IS NULL OR (a.staff_id IS NOT NULL)=CAST({query.HasResponsibility} AS boolean))
                AND (CAST({status} AS text) IS NULL OR o.status=CAST({status} AS text))
                AND (CAST({priority} AS text) IS NULL OR o.priority=CAST({priority} AS text))
                AND (CAST({query.DueFrom?.ToUniversalTime()} AS timestamptz) IS NULL OR o.due_at>=CAST({query.DueFrom?.ToUniversalTime()} AS timestamptz))
                AND (CAST({query.DueTo?.ToUniversalTime()} AS timestamptz) IS NULL OR o.due_at<=CAST({query.DueTo?.ToUniversalTime()} AS timestamptz))
                AND (CAST({query.IsOverdue} AS boolean) IS NULL OR
                    (COALESCE(o.due_at<{now.ToUniversalTime()},false) AND o.status NOT IN ('2','3'))=CAST({query.IsOverdue} AS boolean))
                AND (NOT {query.LatestActionable} OR (o.status IN ('0','1') AND (k.kind<>2 OR o.contract_id IS NULL)))
            """);
        var count = await rows.CountAsync(t);
        var ordered = query.LatestActionable ? rows.OrderByDescending(x => x.CreatedAt)
            : query.ActionableOnly ? rows.OrderBy(x => x.Status == 1 ? 0 : 1).ThenBy(x => x.CreatedAt)
            : rows.OrderBy(x => x.DueAt);
        var page = await ordered.ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var ids = page.Select(x => x.Id).ToArray();
        var tasks = (await Roots(db).Where(x => ids.Contains(x.Id)).ToArrayAsync(t)).ToDictionary(x => x.Id, NativeCaptureReads.Task);
        return new(page.Where(x => tasks.ContainsKey(x.Id)).Select(x =>
        {
            var task = tasks[x.Id];
            return new TaskView(task.Id, task.RequiredLocationId, task.Kind.ToString(), task.TaskTitle, task.Requirements, task.TaskPriority.ToString(),
                task.DueAt, task.EvidenceRequired, task.MeterStatus.ToString(), task.IsOverdue(now), x.Responsible, task.AssignedStaffUserId,
                x.Responsible != null, task.Result, task.Version, task.VerifiedByUserId, task.VerifiedAt, task.CreatedAt, task.UpdatedAt,
                OperationalTaskService.TargetView(task));
        }).ToArray(), query.Page, query.PageSize, count);
    }

    internal static async Task<TaskHistoryView[]> HistoryAsync(Compact24DbContext db, Guid taskId, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM operational_tasks o
            CROSS JOIN LATERAL jsonb_array_elements(o.history) h
            WHERE o.id={taskId} AND h->>'recordType'='OperationalTaskHistory'
                AND COALESCE(h->>'deleted','false')<>'true'
            """).ToArrayAsync(t);
        return rows.Select(x => JsonSerializer.Deserialize<TaskHistoryView>(x, Json)!).ToArray();
    }

    private sealed record EvidenceState(Guid Id, Guid TaskId, Guid UploadedByUserId, string ObjectKey, string ContentType,
        string Sha256, long Length, Guid? SubmissionId, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal static async Task<OperationalTaskEvidence[]> EvidenceAsync(Compact24DbContext db, Guid taskId, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT e::text AS "Value" FROM operational_tasks o
            CROSS JOIN LATERAL jsonb_array_elements(o.evidence) e
            WHERE o.id={taskId} AND e->>'recordType'='OperationalTaskEvidence'
            """).ToArrayAsync(t);
        return rows.Select(x =>
        {
            var s = JsonSerializer.Deserialize<EvidenceState>(x, Json)!;
            var e = OperationalTaskEvidence.Rehydrate(s.Id);
            e.TaskId = s.TaskId; e.UploadedByUserId = s.UploadedByUserId; e.ObjectKey = s.ObjectKey;
            e.ContentType = s.ContentType; e.Sha256 = s.Sha256; e.Length = s.Length; e.SubmissionId = s.SubmissionId;
            e.CreatedAt = s.CreatedAt; e.UpdatedAt = s.UpdatedAt;
            return e;
        }).OrderBy(x => x.CreatedAt).ToArray();
    }

    private sealed record CommandState(Guid Id, Guid ActorId, Guid Key, Guid TaskId, string Fingerprint, string ResponseJson,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal static async Task<OperationalTaskCommand?> CommandAsync(Compact24DbContext db, Guid actor, Guid key, CancellationToken t)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='COMMAND' AND task_data->>'recordType'='OperationalTaskCommand'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND task_data->'state'->>'actorId'={actor.ToString()} AND task_data->'state'->>'key'={key.ToString()}
            """).SingleOrDefaultAsync(t);
        if (json is null) return null;
        var s = JsonSerializer.Deserialize<CommandState>(json, Json)!;
        var command = OperationalTaskCommand.Rehydrate(s.Id);
        command.ActorId = s.ActorId; command.Key = s.Key; command.TaskId = s.TaskId; command.Fingerprint = s.Fingerprint;
        command.ResponseJson = s.ResponseJson; command.CreatedAt = s.CreatedAt; command.UpdatedAt = s.UpdatedAt;
        return command;
    }

    private sealed record NoticeState(Guid Id, Guid TaskId, Guid RecipientUserId, Guid EventId, string Event,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal static IQueryable<Native.Notification> NoticeRows(Compact24DbContext db, Guid recipient) =>
        db.Set<Native.Notification>().FromSqlInterpolated($"""
            SELECT * FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='OperationalTaskNotification'
                AND event_data->'state'->>'recipientUserId'={recipient.ToString()}
            """).AsNoTracking();

    internal static OperationalTaskNotification Notice(Native.Notification row)
    {
        var latest = row.DeliveryHistory.EnumerateArray().Reverse().FirstOrDefault(e => e.TryGetProperty("recordType", out var k)
            && k.GetString() == "OperationalTaskNotification");
        var state = latest.ValueKind == JsonValueKind.Object ? latest.GetProperty("state") : row.EventData.GetProperty("state");
        var s = state.Deserialize<NoticeState>(Json)!;
        var notice = OperationalTaskNotification.Rehydrate(s.Id);
        notice.TaskId = s.TaskId; notice.RecipientUserId = s.RecipientUserId; notice.EventId = s.EventId; notice.Event = s.Event;
        notice.CreatedAt = s.CreatedAt; notice.UpdatedAt = s.UpdatedAt; notice.ReadAt = row.ReadAt;
        return notice;
    }

    private static string Envelope(string kind, Guid id, object state, bool deleted = false) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = id.ToString(), deleted, state }, Json);

    internal static async Task WriteEvidenceAsync(Compact24DbContext db, OperationalTaskEvidence e, bool added, CancellationToken t)
    {
        e.Stamp(DateTimeOffset.UtcNow, added);
        var state = JsonSerializer.Serialize(e, Json);
        var history = Envelope("OperationalTaskEvidence", e.Id, e);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET evidence=COALESCE((SELECT jsonb_agg(item ORDER BY n)
                FROM jsonb_array_elements(evidence) WITH ORDINALITY a(item,n) WHERE item->>'id' IS DISTINCT FROM {e.Id.ToString()}),'[]'::jsonb)
                ||jsonb_build_array(CAST({state} AS jsonb)||jsonb_build_object('recordType','OperationalTaskEvidence')),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={e.TaskId} AND task_type IN ('GENERAL','METER_READ')
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Task evidence parent changed.");
    }

    internal static async Task WriteTechnicalAsync(Compact24DbContext db, AuditableEntity item, bool deleted, CancellationToken t)
    {
        if (item is not (OperationalTaskCommand or OperationalTaskFileUpload))
            throw new InvalidOperationException("Unsupported task technical record.");
        var kind = item is OperationalTaskCommand ? "OperationalTaskCommand" : "OperationalTaskFileUpload";
        if (!deleted) item.Stamp(DateTimeOffset.UtcNow, true);
        // Serialize the concrete type, not only AuditableEntity.
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = kind,
            deleted,
            state = JsonSerializer.SerializeToElement(item, item.GetType(), Json)
        }, Json);
        var history = Envelope(kind, item.Id, item, deleted);
        var source = kind + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(item.Id.ToString())));
        var taskType = item is OperationalTaskCommand ? "COMMAND" : "SYSTEM_JOB";
        if (deleted)
        {
            var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET task_data=CAST({data} AS jsonb),history=history||jsonb_build_array(CAST({history} AS jsonb))
                WHERE id={item.Id} AND task_type={taskType} AND task_data->>'recordType'={kind}
                """, t);
            if (affected != 1) throw new DbUpdateConcurrencyException("Task technical record changed.");
        }
        else await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({item.Id},{taskType},{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            """, t);
    }

    internal static async Task MarkNoticeAsync(Compact24DbContext db, OperationalTaskNotification notice, CancellationToken t)
    {
        notice.Stamp(DateTimeOffset.UtcNow, false);
        var history = Envelope("OperationalTaskNotification", notice.Id, notice);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE notifications SET read_at={notice.ReadAt},delivery_history=delivery_history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={notice.Id} AND record_kind='OUTBOX' AND event_data->>'recordType'='OperationalTaskNotification'
                AND event_data->'state'->>'recipientUserId'={notice.RecipientUserId.ToString()} AND read_at IS NULL
            """, t);
    }

    private sealed record UploadState(Guid Id, Guid TaskId, string ObjectKey, DateTimeOffset CleanupAfter,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal static IQueryable<string> Uploads(Compact24DbContext db) =>
        db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='OperationalTaskFileUpload'
                AND COALESCE(task_data->>'deleted','false')<>'true'
            """);
    internal static OperationalTaskFileUpload Upload(string json)
    {
        var s = JsonSerializer.Deserialize<UploadState>(json, Json)!;
        var upload = OperationalTaskFileUpload.Rehydrate(s.Id);
        upload.TaskId = s.TaskId; upload.ObjectKey = s.ObjectKey; upload.CleanupAfter = s.CleanupAfter;
        upload.CreatedAt = s.CreatedAt; upload.UpdatedAt = s.UpdatedAt;
        return upload;
    }

    internal sealed record ConfirmedHandover(Guid ContractId, Guid TenantConfirmedBy, string Snapshot);
    internal static Task<ConfirmedHandover[]> ConfirmedHandoversAsync(Compact24DbContext db, Guid[] contracts, CancellationToken t) =>
        db.Database.SqlQuery<ConfirmedHandover>($"""
            SELECT c.id AS "ContractId",(h->>'tenantConfirmedBy')::uuid AS "TenantConfirmedBy",h->>'snapshot' AS "Snapshot"
            FROM contracts c CROSS JOIN LATERAL (SELECT c.handover->'current' AS h) s
            WHERE c.id=ANY({contracts}) AND (h->>'status')::int={(int)ContractHandoverStatus.Confirmed}
                AND h->>'tenantConfirmedAt' IS NOT NULL AND h->>'staffConfirmedAt' IS NOT NULL
                AND h->>'tenantConfirmedBy' IS NOT NULL AND h->>'staffConfirmedBy' IS NOT NULL
                AND (h->>'tenantConfirmedVersion')::int=(h->>'version')::int
            """).ToArrayAsync(t);
}
