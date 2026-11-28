using System.Globalization;
using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

// Explicit assignment-reconciliation snapshots over the protected Location transaction.
internal static class NativeAssignmentReconciliation
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record TaskState(OperationalTaskKind Kind, ReadingPurpose Purpose, Guid? AssignmentId,
        string? Result, string? LocationAssetInventoryJson);
    internal sealed record TaskResponsibility(Guid Id, OperationalTaskKind Kind, ReadingPurpose Purpose,
        Guid? AssignedStaffUserId, Guid? AssignmentId, DateTimeOffset? AssignedAt, DateTimeOffset? DueAt,
        int Version, MeterTaskStatus Status, string? Result, string LocationAssetInventoryJson);
    internal sealed record InspectionResponsibility(Guid ContractId, Guid Id, Guid? InspectionStaffId, int Version);

    internal static async Task<TaskResponsibility[]> TasksAsync(Compact24DbContext db, Guid location, CancellationToken t)
    {
        var rows = await db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(row => row.StoredLocationId == location &&
            (row.TaskType == "GENERAL" || row.TaskType == "METER_READ") && row.StoredStatus != "2" && row.StoredStatus != "3").ToArrayAsync(t);
        return rows.Select(row =>
        {
            var state = row.TaskData.ValueKind == JsonValueKind.Object && row.TaskData.TryGetProperty("state", out var snapshot) &&
                snapshot.ValueKind == JsonValueKind.Object ? snapshot.Deserialize<TaskState>(Json)! : new TaskState(default, default, null, null, null);
            var kind = state.Kind is OperationalTaskKind.MoveInInventory or OperationalTaskKind.LocationAssetHandover
                ? state.Kind : row.TaskType == "GENERAL" ? OperationalTaskKind.AdHoc : OperationalTaskKind.MeterReading;
            return new TaskResponsibility(row.Id, kind, state.Purpose, row.AssignedUserId, state.AssignmentId, row.AssignedAt,
                row.DueAt, row.Version, (MeterTaskStatus)int.Parse(row.StoredStatus, CultureInfo.InvariantCulture),
                state.Result, state.LocationAssetInventoryJson ?? "");
        }).ToArray();
    }

    internal static async Task<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder[]> OrdersAsync(Compact24DbContext db, Guid location, CancellationToken t) =>
        (await db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(row => row.StoredLocationId == location && row.TaskType == "WORK_ORDER" &&
            row.StoredStatus != "Verified" && row.StoredStatus != "Cancelled").ToArrayAsync(t)).Select(NativeIncidentSession.Read).ToArray();

    internal static Task<InspectionResponsibility[]> InspectionsAsync(Compact24DbContext db, Guid location, CancellationToken t) =>
        db.Database.SqlQuery<InspectionResponsibility>($"""
            SELECT c.id AS "ContractId",(m->>'id')::uuid AS "Id",(m->>'inspectionStaffId')::uuid AS "InspectionStaffId",
                (m->>'version')::int AS "Version"
            FROM contracts c JOIN rooms r ON r.id=c.room_id CROSS JOIN LATERAL (SELECT c.move_out->'current' AS m) s
            WHERE r.location_id={location} AND m->>'inspectionStaffId' IS NOT NULL
                AND COALESCE((m->>'status')::int,0)<>{(int)MoveOutStatus.Completed} AND m->>'inspectedAt' IS NULL
            """).ToArrayAsync(t);

    private static string Envelope(string kind, Guid id, object state) => JsonSerializer.Serialize(new
    {
        schemaVersion = 1,
        recordType = kind,
        recordKey = id.ToString(),
        deleted = false,
        state
    }, Json);

    internal static async Task TaskHistoryAsync(Compact24DbContext db, OperationalTaskHistory history, CancellationToken t)
    {
        history.Stamp(DateTimeOffset.UtcNow, true);
        var envelope = Envelope("OperationalTaskHistory", history.Id, history);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET history=history||jsonb_build_array(CAST({envelope} AS jsonb))
            WHERE id={history.TaskId} AND task_type IN ('GENERAL','METER_READ')
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Task responsibility changed.");
    }

    internal static async Task TaskNoticeAsync(Compact24DbContext db, OperationalTaskNotification notice, CancellationToken t)
    {
        notice.Stamp(DateTimeOffset.UtcNow, true);
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "OperationalTaskNotification",
            state = notice,
            audienceRole = (string?)null,
            category = (string?)null,
            succeeded = (bool?)null,
            sessionId = (Guid?)null,
            targetUserId = (Guid?)null
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,read_at)
            VALUES({notice.Id},'OUTBOX',{"OperationalTaskNotification:" + notice.Id},'OperationalTaskNotification',
                CAST({data} AS jsonb),{notice.CreatedAt},{notice.ReadAt})
            """, t);
    }

    internal static async Task InspectionAsync(Compact24DbContext db, InspectionResponsibility inspection,
        Guid staff, Guid actor, DateTimeOffset now, string reason, CancellationToken t)
    {
        var version = inspection.Version + 1;
        var stamp = DateTimeOffset.UtcNow;
        var history = new ContractMoveOutHistory
        {
            ContractId = inspection.ContractId,
            ActorId = actor,
            Action = "InspectionResponsibilityChanged",
            OccurredAt = now,
            Version = version,
            Snapshot = JsonSerializer.Serialize(new { previous = inspection.InspectionStaffId, InspectionStaffId = staff, Version = version, reason }, Json)
        };
        history.Stamp(stamp, true);
        var envelope = Envelope("ContractMoveOutHistory", history.Id, history);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts c SET move_out=jsonb_set(c.move_out,ARRAY['current'],
                c.move_out->'current'||jsonb_build_object('inspectionStaffId',{staff},'version',{version},'updatedAt',{stamp}),true),
                history=c.history||jsonb_build_array(jsonb_build_object('schemaVersion',1,'recordType','ContractMoveOut',
                    'recordKey',{inspection.Id.ToString()},'deleted',false,
                    'state',c.move_out->'current'||jsonb_build_object('inspectionStaffId',{staff},'version',{version},'updatedAt',{stamp})),
                    CAST({envelope} AS jsonb))
            WHERE c.id={inspection.ContractId} AND c.move_out->'current'->>'id'={inspection.Id.ToString()}
                AND (c.move_out->'current'->>'version')::int={inspection.Version}
                AND c.move_out->'current'->>'inspectionStaffId'={inspection.InspectionStaffId.ToString()}
                AND c.move_out->'current'->>'inspectedAt' IS NULL
                AND COALESCE((c.move_out->'current'->>'status')::int,0)<>{(int)MoveOutStatus.Completed}
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Move-out inspection responsibility changed.");
    }
}
