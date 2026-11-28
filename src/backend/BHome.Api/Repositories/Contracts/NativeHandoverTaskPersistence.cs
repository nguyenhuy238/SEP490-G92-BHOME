using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal static class NativeHandoverTaskPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static Task<OperationalTask?> FindAsync(Compact24DbContext db, Guid id, CancellationToken t) =>
        NativeOperationalTaskPersistence.FindAsync(db, id, t);

    internal static Task<bool> HasCurrentAsync(Compact24DbContext db, Guid id, CancellationToken t) =>
        db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts WHERE id={id} AND jsonb_typeof(handover->'current')='object') AS "Value"
            """).SingleAsync(t);

    internal static async Task<OperationalTask[]> ForContractsAsync(Compact24DbContext db, Guid[] contracts, CancellationToken t) =>
        (await NativeOperationalTaskPersistence.Roots(db).Where(x => x.ContractId != null && contracts.Contains(x.ContractId.Value))
            .ToArrayAsync(t)).Select(NativeCaptureReads.Task).ToArray();

    internal static async Task WriteAsync(Compact24DbContext db, OperationalTask task, bool added, OperationalTaskHistory? history, CancellationToken t)
    {
        try { await NativeCaptureWrites.TaskAsync(db, task, added, added ? 0 : task.Version - 1, t); }
        catch (CaptureConflictException) { throw ContractException.Conflict("contract_concurrent_or_duplicate_operation"); }
        if (history is not null) await NativeAssignmentReconciliation.TaskHistoryAsync(db, history, t);
    }

    internal static Task<bool> HasProgressAsync(Compact24DbContext db, Guid[] ids, CancellationToken t) =>
        db.Database.SqlQuery<bool>($"""
            SELECT (EXISTS(SELECT 1 FROM operational_tasks o
                WHERE o.id=ANY({ids}) AND (
                    EXISTS(SELECT 1 FROM jsonb_array_elements(o.evidence) e
                        WHERE e->>'recordType' IN ('OperationalTaskEvidence','MeterEvidence'))
                    OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.history) h
                        WHERE h->>'recordType'='OperationalTaskHistory'
                        AND COALESCE(h->>'deleted','false')<>'true'
                        AND h->'state'->>'action' NOT IN ('MoveInCreated','MoveInInventoryCreated','responsibility_changed',
                            'MoveInDuplicateCancelled','MoveInDuplicateResumed'))))
                OR EXISTS(SELECT 1 FROM operational_tasks o WHERE o.task_type='SYSTEM_JOB'
                    AND o.task_data->>'recordType'='OperationalTaskFileUpload'
                    AND COALESCE(o.task_data->>'deleted','false')<>'true'
                    AND (o.task_data->'state'->>'taskId')::uuid=ANY({ids}))
                OR EXISTS(SELECT 1 FROM meter_readings r WHERE r.operational_task_id=ANY({ids}))) AS "Value"
            """).SingleAsync(t);

    internal static Task<HandoverReading[]> ReadingsAsync(Compact24DbContext db, Guid contractId, Guid roomId, DateOnly startDate, CancellationToken t) =>
        db.Database.SqlQuery<HandoverReading>($"""
            SELECT r.id AS "Id",m.meter_code AS "MeterCode",m.utility_type::int AS "UtilityType",
                (o.task_data->'state'->>'readingDate')::date AS "Date",r.confirmed_value AS "Value",
                (e->>'id')::uuid AS "EvidenceId",e->>'objectKey' AS "EvidenceObjectKey",e->>'imageHash' AS "EvidenceHash"
            FROM meter_readings r JOIN operational_tasks o ON o.id=r.operational_task_id
            JOIN meters m ON m.id=r.meter_id
            CROSS JOIN LATERAL jsonb_array_elements(o.evidence) e
            WHERE m.room_id={roomId} AND m.is_active AND o.contract_id={contractId}
                AND r.reading_purpose=0 AND o.status='2'
                AND (o.task_data->'state'->>'readingDate')::date>={startDate}
                AND e->>'recordType'='MeterEvidence' AND e->>'id'=r.evidence->>'id'
                AND (e->>'isUploaded')::bool AND (e->>'isLinked')::bool
            ORDER BY (o.task_data->'state'->>'readingDate')::date DESC LIMIT 100
            """).ToArrayAsync(t);

    internal static Task<HandoverReading?> ReadingAsync(Compact24DbContext db, Guid roomId, Guid readingId, CancellationToken t) =>
        db.Database.SqlQuery<HandoverReading>($"""
            SELECT r.id AS "Id",m.meter_code AS "MeterCode",m.utility_type::int AS "UtilityType",
                (o.task_data->'state'->>'readingDate')::date AS "Date",r.confirmed_value AS "Value",
                (e->>'id')::uuid AS "EvidenceId",e->>'objectKey' AS "EvidenceObjectKey",e->>'imageHash' AS "EvidenceHash"
            FROM meter_readings r JOIN operational_tasks o ON o.id=r.operational_task_id
            JOIN meters m ON m.id=r.meter_id CROSS JOIN LATERAL jsonb_array_elements(o.evidence) e
            WHERE r.id={readingId} AND m.room_id={roomId} AND e->>'recordType'='MeterEvidence'
                AND e->>'id'=r.evidence->>'id' AND (e->>'isUploaded')::bool AND (e->>'isLinked')::bool
            """).SingleOrDefaultAsync(t);

    internal static IQueryable<HandoverReading> FinalReadings(Compact24DbContext db, Guid contractId, Guid roomId,
        Guid? readingId, DateOnly? date, bool activeMeter, bool strict) =>
        db.Database.SqlQuery<HandoverReading>($"""
            SELECT r.id AS "Id",m.meter_code AS "MeterCode",m.utility_type::int AS "UtilityType",
                (o.task_data->'state'->>'readingDate')::date AS "Date",r.confirmed_value AS "Value",
                (e->>'id')::uuid AS "EvidenceId",e->>'objectKey' AS "EvidenceObjectKey",e->>'imageHash' AS "EvidenceHash"
            FROM meter_readings r JOIN operational_tasks o ON o.id=r.operational_task_id
            JOIN meters m ON m.id=r.meter_id CROSS JOIN LATERAL jsonb_array_elements(o.evidence) e
            WHERE m.room_id={roomId} AND (NOT {activeMeter} OR m.is_active)
                AND o.contract_id={contractId} AND o.task_type='METER_READ' AND o.status='2'
                AND (o.task_data->'state'->>'purpose')::int=2
                AND (CAST({readingId} AS uuid) IS NULL OR r.id={readingId})
                AND (CAST({date} AS date) IS NULL OR (o.task_data->'state'->>'readingDate')::date={date})
                AND e->>'recordType'='MeterEvidence' AND e->>'id'=r.evidence->>'id'
                AND (e->>'isUploaded')::bool AND (e->>'isLinked')::bool
                AND (NOT {strict} OR (o.meter_id=r.meter_id AND (e->>'taskId')::uuid=o.id))
            """);

    private sealed record HistoryState(Guid Id, Guid ContractId, int Version, string Action, Guid ActorId,
        DateTimeOffset OccurredAt, string Snapshot, Guid ElectricityReadingId, Guid WaterReadingId, string Note,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal static async Task<ContractHandoverHistory[]> HistoryAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE c.id={id} AND h->>'recordType'='ContractHandoverHistory' AND COALESCE(h->>'deleted','false')<>'true'
            ORDER BY (h->'state'->>'occurredAt')::timestamptz DESC LIMIT 100
            """).ToArrayAsync(t);
        return rows.Select(x =>
        {
            var s = JsonSerializer.Deserialize<HistoryState>(x, Json)!;
            var value = ContractHandoverHistory.Rehydrate(s.Id);
            value.ContractId = s.ContractId; value.Version = s.Version; value.Action = s.Action; value.ActorId = s.ActorId;
            value.OccurredAt = s.OccurredAt; value.Snapshot = s.Snapshot; value.ElectricityReadingId = s.ElectricityReadingId;
            value.WaterReadingId = s.WaterReadingId; value.Note = s.Note; value.CreatedAt = s.CreatedAt; value.UpdatedAt = s.UpdatedAt;
            return value;
        }).ToArray();
    }
}
