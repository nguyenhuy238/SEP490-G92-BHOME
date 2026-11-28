using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

// The operational_tasks technical row keeps its historical JSON contract and
// append-only attempt records. Lease acquisition and completion use the same lock.
internal static class NativeBillingJobPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string Envelope(string kind, Guid id, object state) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = id.ToString(), deleted = false, state }, Json);
    private static string Period(DateOnly period) => period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    internal static async Task<IReadOnlyList<BillingQueueView>> QueueAsync(Compact24DbContext db, Guid location, DateOnly period, CancellationToken t) =>
        await db.Database.SqlQuery<BillingQueueView>($"""
            SELECT j.id AS "Id",j.task_data->>'name' AS "Name",j.status AS "State",j.attempt_count AS "Attempts",
              j.next_run_at AS "AvailableAt",j.locked_until AS "LockedUntil",j.task_data->>'lastErrorCode' AS "LastErrorCode"
            FROM operational_tasks j JOIN locations l ON l.id={location}
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.operating_settings->'automationPlanVersions','[]'::jsonb)) p
            WHERE j.task_type='SYSTEM_JOB' AND j.task_data->'payload'->>'PlanId'=p->>'id'
              AND j.task_data->'payload'->>'BillingPeriod'={Period(period)}
              AND j.task_data->>'name' IN ('billing-meter','billing-draft','billing-final')
            ORDER BY j.next_run_at DESC LIMIT 30
            """).ToArrayAsync(t);

    private static BillingAutomationExecution Read(Native.OperationalTask row) =>
        row.TaskData.GetProperty("state").Deserialize<BillingAutomationExecution>(Json)
        ?? throw new InvalidOperationException("Invalid billing execution state.");

    internal static IQueryable<Native.OperationalTask> Rows(Compact24DbContext db) =>
        db.Set<Native.OperationalTask>().FromSqlRaw("""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB'
              AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true'
            """).AsNoTracking();

    internal static async Task<BillingAutomationExecution?> ExecutionAsync(Compact24DbContext db, Guid plan, DateOnly period,
        string phase, CancellationToken t, bool locked = false)
    {
        var key = Period(period);
        var rows = locked ? db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true'
              AND task_data->'state'->>'planId'={plan.ToString()} AND task_data->'state'->>'billingPeriod'={key}
              AND task_data->'state'->>'phase'={phase} FOR UPDATE
            """) : db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true'
              AND task_data->'state'->>'planId'={plan.ToString()} AND task_data->'state'->>'billingPeriod'={key}
              AND task_data->'state'->>'phase'={phase}
            """);
        var row = await rows.AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : Read(row);
    }

    internal static async Task<BillingAutomationExecution> ByIdAsync(Compact24DbContext db, Guid id, CancellationToken t) =>
        Read(await Rows(db).SingleAsync(r => r.Id == id, t));

    internal static async Task<BillingAutomationExecution[]> ExecutionsAsync(Compact24DbContext db, Guid location, DateOnly period, CancellationToken t)
    {
        var key = Period(period);
        var states = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true'
              AND task_data->'state'->>'locationId'={location.ToString()} AND task_data->'state'->>'billingPeriod'={key}
            ORDER BY (task_data->'state'->>'lastStartedAt')::timestamptz DESC LIMIT 100
            """).ToArrayAsync(t);
        return states.Select(s => JsonSerializer.Deserialize<BillingAutomationExecution>(s, Json)!).ToArray();
    }

    internal static async Task<BillingAutomationAttempt[]> AttemptsAsync(Compact24DbContext db, Guid location, DateOnly period, CancellationToken t)
    {
        var key = Period(period);
        var states = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM operational_tasks
            CROSS JOIN LATERAL (SELECT DISTINCT ON (value->>'recordKey') value AS h
                FROM jsonb_array_elements(history) WITH ORDINALITY a(value,n)
                WHERE value->>'recordType'='BillingAutomationAttempt' ORDER BY value->>'recordKey',n DESC) latest
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true' AND COALESCE(h->>'deleted','false')<>'true'
              AND task_data->'state'->>'locationId'={location.ToString()} AND task_data->'state'->>'billingPeriod'={key}
            ORDER BY (h->'state'->>'startedAt')::timestamptz DESC LIMIT 100
            """).ToArrayAsync(t);
        return states.Select(s => JsonSerializer.Deserialize<BillingAutomationAttempt>(s, Json)!).ToArray();
    }

    internal static Task<DateOnly[]> PendingPeriodsAsync(Compact24DbContext db, Guid location, DateOnly before, CancellationToken t) =>
        db.Database.SqlQuery<DateOnly>($"""
            SELECT DISTINCT (task_data->'state'->>'billingPeriod')::date AS "Value" FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
              AND COALESCE(task_data->>'deleted','false')<>'true'
              AND task_data->'state'->>'locationId'={location.ToString()}
              AND (task_data->'state'->>'billingPeriod')::date<{before}
              AND task_data->'state'->>'status' IN ('PendingInputs','Processing')
            """).ToArrayAsync(t);

    internal static Task<Guid[]> LocationsAsync(Compact24DbContext db, Guid? after, CancellationToken t) =>
        db.Set<Native.Location>().FromSqlRaw("""
            SELECT * FROM locations WHERE jsonb_array_length(COALESCE(operating_settings->'automationPlanVersions','[]'::jsonb))>0
            """).AsNoTracking().Where(l => after == null || l.Id.CompareTo(after.Value) > 0).OrderBy(l => l.Id)
            .Select(l => l.Id).Take(100).ToArrayAsync(t);

    internal static async Task SaveAsync(Compact24DbContext db, BillingAutomationExecution e, bool added, Guid? previousToken, CancellationToken t)
    {
        RequireTransaction(db);
        const string kind = "BillingAutomationExecution";
        var sourceKey = kind + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(e.Id.ToString())));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, deleted = false, state = e }, Json);
        var history = Envelope(kind, e.Id, e);
        var changed = added ? await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({e.Id},'SYSTEM_JOB',{sourceKey},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
            """, t) : await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET task_data=CAST({data} AS jsonb),history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={e.Id} AND task_type='SYSTEM_JOB' AND task_data->>'recordType'={kind}
              AND (task_data->'state'->>'lockToken')::uuid IS NOT DISTINCT FROM {previousToken}
            """, t);
        if (changed != 1) throw new DbUpdateConcurrencyException("Billing execution lease changed.");
    }

    internal static async Task AppendAttemptAsync(Compact24DbContext db, BillingAutomationAttempt a, CancellationToken t)
    {
        RequireTransaction(db);
        var history = Envelope("BillingAutomationAttempt", a.Id, a);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={a.ExecutionId} AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='BillingAutomationExecution'
            """, t);
        if (changed != 1) throw new DbUpdateConcurrencyException("Billing execution missing.");
    }

    internal static Task<int> CreatedCountAsync(Compact24DbContext db, Guid plan, DateOnly period, string phase, CancellationToken t)
    {
        var id = plan.ToString();
        return phase == "Meter"
            ? db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
                SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND task_data->'state'->>'automationPlanId'={id}
                """).AsNoTracking().CountAsync(task => task.BillingPeriod == period, t)
            : db.Set<Native.Invoice>().FromSqlInterpolated($"""
                SELECT * FROM invoices WHERE billing_snapshot->'compactState'->>{(phase == "Draft" ? "automationPlanId" : "automationFinalizationPlanId")}={id}
                """).AsNoTracking().CountAsync(i => i.BillingPeriod == period, t);
    }

    internal sealed record StaffAssignment(Guid Id, Guid StaffUserId, DateOnly StartDate, DateOnly EndDate);

    internal static async Task<StaffAssignment[]> AssignmentsAsync(Compact24DbContext db, Guid location, DateOnly date, CancellationToken t)
    {
        var json = await db.Set<Native.Location>().AsNoTracking().Where(l => l.Id == location)
            .Select(l => l.StaffAssignments).SingleOrDefaultAsync(t);
        if (json.ValueKind != JsonValueKind.Array) return [];
        var assignments = (json.Deserialize<StaffAssignment[]>(Json) ?? [])
            .Where(a => a.StartDate <= date && a.EndDate >= date).ToArray();
        var staffIds = assignments.Select(a => a.StaffUserId).Distinct().ToArray();
        var eligible = await StaffEmploymentEligibility.EligibleIds(db, date).Where(id => staffIds.Contains(id)).ToArrayAsync(t);
        return assignments.Where(a => eligible.Contains(a.StaffUserId)).ToArray();
    }

    internal static async Task<OperationalTask?> PeriodicTaskAsync(Compact24DbContext db, Guid room, UtilityType type, DateOnly period, CancellationToken t)
    {
        var row = await db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE task_type='METER_READ'
                AND task_data->'state'->>'billingRoomId'={room.ToString()}
                AND (task_data->'state'->>'billingUtilityType')::integer={(int)type} AND billing_period={period}
            FOR UPDATE
            """).AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : NativeCaptureReads.Task(row);
    }

    internal static async Task<OperationalTask?> LockedMeterTaskAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var row = await db.Set<Native.OperationalTask>().FromSqlInterpolated($"""
            SELECT * FROM operational_tasks WHERE id={id} AND task_type='METER_READ' FOR UPDATE
            """).AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : NativeCaptureReads.Task(row);
    }

    internal static async Task UpdateRoutingAsync(Compact24DbContext db, OperationalTask task, int originalVersion, CancellationToken t)
    {
        RequireTransaction(db);
        task.Stamp(DateTimeOffset.UtcNow, false);
        var changedState = JsonSerializer.Serialize(new { task.AssignedStaffUserId, task.AssignmentId,
            task.AssignedAt, task.Version, task.UpdatedAt }, Json);
        var count = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET assigned_user_id={task.AssignedStaffUserId},assigned_at={task.AssignedAt},version={task.Version},
              task_data=task_data||jsonb_build_object('state',task_data->'state'||CAST({changedState} AS jsonb)),
              history=history||jsonb_build_array(jsonb_build_object('schemaVersion',1,'recordType','OperationalTask',
                'recordKey',id::text,'deleted',false,'state',task_data->'state'||CAST({changedState} AS jsonb)))
            WHERE id={task.Id} AND task_type='METER_READ' AND version={originalVersion}
              AND status NOT IN ('2','3')
            """, t);
        if (count != 1) throw new DbUpdateConcurrencyException("Meter assignment changed.");
    }

    internal static async Task AppendTaskEventAsync(Compact24DbContext db, OperationalTaskHistory h, OperationalTaskNotification? notice, CancellationToken t)
    {
        RequireTransaction(db);
        h.Stamp(DateTimeOffset.UtcNow, true);
        var history = Envelope("OperationalTaskHistory", h.Id, h);
        if (await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={h.TaskId} AND task_type='METER_READ'
            """, t) != 1) throw new DbUpdateConcurrencyException("Meter task missing.");
        if (notice is null) return;
        notice.Stamp(DateTimeOffset.UtcNow, true);
        const string kind = "OperationalTaskNotification";
        var eventData = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, state = notice,
            audienceRole = (string?)null, category = (string?)null, succeeded = (bool?)null,
            sessionId = (Guid?)null, targetUserId = (Guid?)null }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,read_at)
            VALUES({notice.Id},'OUTBOX',{kind + ":" + notice.Id},{kind},CAST({eventData} AS jsonb),{notice.CreatedAt},{notice.ReadAt})
            """, t);
    }

    private static void RequireTransaction(Compact24DbContext db)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Billing job write requires a transaction.");
    }
}
