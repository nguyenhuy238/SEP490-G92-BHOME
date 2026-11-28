using System.Text.Json;
using BHome.Domain.Common;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Notifications;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// Detached business values are cached for the duration of one command, just as
// a tracked aggregate previously was. Only changed values append snapshots.
internal sealed class NativeIncidentSession(Compact24DbContext db)
{
    private sealed record Pending(AuditableEntity Entity, string? Original, int? Version);
    private readonly Dictionary<(Type, Guid), Pending> pending = new();
    private readonly List<SecurityAuditEvent> audits = [];
    private readonly List<UserNotification> inbox = [];
    private static readonly JsonSerializerOptions Json = IncidentSnapshots.Json;

    internal void Clear()
    {
        pending.Clear();
        audits.Clear();
        inbox.Clear();
    }

    private static int? Version(AuditableEntity entity) => entity switch
    {
        IncidentReport r => r.Version,
        MaintenanceWorkOrder w => w.Version,
        MaintenanceCompensation c => c.Version,
        FastRepairPolicy p => p.Version,
        Asset a => a.Version,
        _ => null
    };
    private static string Snapshot(AuditableEntity entity) => entity is Asset asset
        ? JsonSerializer.Serialize(new
        {
            asset.Id,
            asset.LocationId,
            asset.RoomId,
            asset.CommonArea,
            asset.Code,
            asset.Name,
            asset.Category,
            asset.Condition,
            asset.Status,
            asset.Version,
            asset.CreatedAt,
            asset.UpdatedAt
        }, Json)
        : IncidentSnapshots.State(entity).GetRawText();
    private T Track<T>(T entity) where T : AuditableEntity
    {
        var key = (typeof(T), entity.Id);
        if (pending.TryGetValue(key, out var current)) return (T)current.Entity;
        pending.Add(key, new(entity, Snapshot(entity), Version(entity)));
        return entity;
    }
    internal bool Add(object entity)
    {
        if (entity is UserNotification notice) { inbox.Add(notice); return true; }
        if (entity is not (IncidentReport or MaintenanceWorkOrder or Asset or IncidentActivity or IncidentEvidence or
            EmergencyAction or MaintenanceExpense or MaintenanceHistory or IncidentCommand or IncidentNotification or
            FastRepairPolicy or MaintenanceCompensation)) return false;
        var row = (AuditableEntity)entity;
        pending.Add((row.GetType(), row.Id), new(row, null, null));
        return true;
    }
    internal void Audit(Guid actor, string action, Guid target, DateTimeOffset at) =>
        audits.Add(new(Guid.NewGuid(), actor, null, null, action, true, at, "IncidentActivity", target));

    internal static IncidentReport Read(Native.IncidentReport row)
    {
        var state = IncidentSnapshots.Latest(row.History, "IncidentReport");
        var report = state.ValueKind == JsonValueKind.Object
            ? state.Deserialize<IncidentSnapshots.IncidentReportState>(Json)!.ToDomain()
            : IncidentReport.Rehydrate(row.Id, row.ReportedAt, DateTimeOffset.UnixEpoch);
        report.LocationId = row.LocationId;
        report.RoomId = row.RoomId;
        report.AssetId = row.AssetId;
        report.ReporterId = row.ReporterUserId;
        report.ReporterRole ??= "";
        report.Description = row.Description;
        report.Severity = row.Severity == "EMERGENCY" ? IncidentSeverity.Emergency : IncidentSeverity.Normal;
        report.Status = Enum.Parse<IncidentStatus>(row.Status);
        report.DuplicateOfId = row.DuplicateOfReportId;
        report.CreatedAt = row.ReportedAt;
        report.ResolvedAt = row.ResolvedAt;
        report.Version = row.Version;
        return report;
    }
    internal static MaintenanceWorkOrder Read(Native.OperationalTask row)
    {
        var state = row.TaskData.TryGetProperty("state", out var value) ? value : default;
        var work = state.ValueKind == JsonValueKind.Object
            ? state.Deserialize<IncidentSnapshots.MaintenanceWorkOrderState>(Json)!.ToDomain()
            : MaintenanceWorkOrder.Rehydrate(row.Id, DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch);
        work.IncidentId = row.IncidentReportId;
        work.LocationId = row.LocationId ?? Guid.Empty;
        work.RoomId = row.RoomId;
        work.AssetId = row.AssetId;
        work.AssignedStaffId = row.AssignedUserId ?? Guid.Empty;
        work.TargetCompletionAt = row.DueAt ?? DateTimeOffset.UnixEpoch;
        work.EstimatedCost = row.EstimatedCost;
        work.ApprovedById = row.CostApprovedByUserId;
        work.ApprovedAt = row.CostApprovedAt;
        work.VerifiedById = row.VerifiedByUserId;
        work.VerifiedAt = row.VerifiedAt;
        work.Status = Enum.Parse<WorkOrderStatus>(row.Status);
        work.Version = row.Version;
        work.Source ??= "Incident";
        work.Description ??= "";
        work.ExpectedOutcome ??= "";
        return work;
    }
    internal async Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t)
    {
        if (pending.TryGetValue((typeof(IncidentReport), id), out var current)) return (IncidentReport)current.Entity;
        var row = await db.Set<Native.IncidentReport>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
        return row is null ? null : Track(Read(row));
    }
    internal async Task<MaintenanceWorkOrder?> WorkAsync(Guid id, CancellationToken t)
    {
        if (pending.TryGetValue((typeof(MaintenanceWorkOrder), id), out var current)) return (MaintenanceWorkOrder)current.Entity;
        var row = await db.Set<Native.OperationalTask>().AsNoTracking()
            .SingleOrDefaultAsync(w => w.Id == id && w.TaskType == "WORK_ORDER", t);
        return row is null ? null : Track(Read(row));
    }
    internal async Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t) =>
        (await db.Set<Native.OperationalTask>().AsNoTracking().Where(w => w.TaskType == "WORK_ORDER" && w.IncidentReportId == incident)
            .OrderBy(w => w.Id).ToArrayAsync(t)).Select(w => Track(Read(w))).ToArray();
    internal async Task<Asset?> AssetAsync(Guid id, CancellationToken t)
    {
        if (pending.TryGetValue((typeof(Asset), id), out var current)) return (Asset)current.Entity;
        var row = await db.Set<Native.Asset>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, t);
        return row is null ? null : Track(NativeAssetPersistence.Read(row));
    }
    internal async Task<FastRepairPolicy?> PolicyAsync(CancellationToken t)
    {
        if (pending.TryGetValue((typeof(FastRepairPolicy), FastRepairPolicy.GlobalId), out var current)) return (FastRepairPolicy)current.Entity;
        var row = await db.Set<Native.OperationalTask>().AsNoTracking()
            .SingleOrDefaultAsync(w => w.Id == FastRepairPolicy.GlobalId && w.TaskType == "SYSTEM_JOB", t);
        return row is null || !row.TaskData.TryGetProperty("state", out var state) ? null :
            Track(state.Deserialize<IncidentSnapshots.FastRepairPolicyState>(Json)!.ToDomain());
    }
    internal async Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t)
    {
        var raw = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='COMMAND' AND task_data->>'recordType'='IncidentCommand'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND (task_data->'state'->>'actorId')::uuid={actor} AND (task_data->'state'->>'key')::uuid={key}
            """).SingleOrDefaultAsync(t);
        return raw is null ? null : JsonSerializer.Deserialize<IncidentSnapshots.IncidentCommandState>(raw, Json)!.ToDomain();
    }
    internal async Task<MaintenanceCompensation?> CompensationAsync(Guid work, CancellationToken t)
    {
        var row = await db.Set<Native.OperationalTask>().AsNoTracking()
            .Where(w => w.Id == work && w.TaskType == "WORK_ORDER").Select(w => w.History).SingleOrDefaultAsync(t);
        if (row.ValueKind != JsonValueKind.Array) return null;
        var state = IncidentSnapshots.Latest(row, "MaintenanceCompensation");
        return state.ValueKind == JsonValueKind.Object
            ? Track(state.Deserialize<IncidentSnapshots.MaintenanceCompensationState>(Json)!.ToDomain()) : null;
    }
    internal async Task<IReadOnlyList<EmergencyAction>> EmergencyAsync(Guid incident, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (s.h->'state')::text AS "Value" FROM incident_reports r
            CROSS JOIN LATERAL (SELECT DISTINCT ON (h->>'recordKey') h FROM jsonb_array_elements(r.history)
                WITH ORDINALITY a(h,n) WHERE h->>'recordType'='EmergencyAction' ORDER BY h->>'recordKey',n DESC) s
            WHERE r.id={incident} AND COALESCE(s.h->>'deleted','false')<>'true'
            """).ToArrayAsync(t);
        return rows.Select(raw => Track(JsonSerializer.Deserialize<IncidentSnapshots.EmergencyActionState>(raw, Json)!.ToDomain()))
            .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArray();
    }
    internal async Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid? incident, Guid? work, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (s.h->'state')::text AS "Value" FROM (
                SELECT history FROM incident_reports
                UNION ALL SELECT history FROM operational_tasks WHERE task_type='WORK_ORDER'
            ) parents
            CROSS JOIN LATERAL (SELECT DISTINCT ON (h->>'recordKey') h FROM jsonb_array_elements(parents.history)
                WITH ORDINALITY a(h,n) WHERE h->>'recordType'='IncidentEvidence' ORDER BY h->>'recordKey',n DESC) s
            WHERE COALESCE(s.h->>'deleted','false')<>'true'
                AND (CAST({incident} AS uuid) IS NOT NULL AND (s.h->'state'->>'incidentId')::uuid={incident}
                    OR CAST({work} AS uuid) IS NOT NULL AND (s.h->'state'->>'workOrderId')::uuid={work})
            """).ToArrayAsync(t);
        return rows.Select(raw => Track(JsonSerializer.Deserialize<IncidentSnapshots.IncidentEvidenceState>(raw, Json)!.ToDomain()))
            .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToArray();
    }
    internal async Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t)
    {
        var notice = await ReadNotificationAsync(db, id, t);
        return notice is not null && notice.RecipientId == actor ? Track(notice) : null;
    }

    internal static async Task<IncidentNotification?> ReadNotificationAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var row = await db.Set<Native.Notification>().AsNoTracking()
            .SingleOrDefaultAsync(n => n.Id == id && n.RecordKind == "OUTBOX", t);
        if (row is null || !row.EventData.TryGetProperty("recordType", out var kind) || kind.GetString() != "IncidentNotification") return null;
        var state = IncidentSnapshots.Latest(row.DeliveryHistory, "IncidentNotification");
        if (state.ValueKind != JsonValueKind.Object) state = row.EventData.GetProperty("state");
        var notice = state.Deserialize<IncidentSnapshots.IncidentNotificationState>(Json)!.ToDomain();
        notice.ReadAt = row.ReadAt;
        return notice;
    }

    internal async Task FlushAsync(CancellationToken token)
    {
        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        // Existing external module changes may share the transaction. Preserve
        // the prior flush boundary without mixing native and legacy tracked rows.
        await db.SaveChangesAsync(token);
        var changes = pending.Values.Where(p => p.Original is null || p.Original != Snapshot(p.Entity)).ToArray();
        foreach (var change in changes.Where(p => p.Entity is Asset))
            await NativeAssetPersistence.StageAsync(db, (Asset)change.Entity, change.Version, null, DateTimeOffset.UtcNow, token);
        if (changes.Any(p => p.Entity is Asset)) await db.SaveChangesAsync(token);
        foreach (var change in changes.Where(p => p.Entity is not Asset)
                     .OrderBy(p => p.Entity switch { IncidentReport => 0, MaintenanceWorkOrder => 1, IncidentActivity => 2, _ => 3 }))
        {
            if (change.Entity is IncidentNotification notice && change.Original is not null)
            {
                var previous = JsonSerializer.Deserialize<IncidentSnapshots.IncidentNotificationState>(change.Original, Json)!;
                var current = IncidentSnapshots.IncidentNotificationState.From(notice);
                if (previous != (current with
                {
                    ReadAt = previous.ReadAt,
                    DeliveryState = previous.DeliveryState,
                    DeliveryReference = previous.DeliveryReference,
                    DeliveryError = previous.DeliveryError
                }))
                    throw new InvalidOperationException("Incident notification event is immutable.");
            }
            await NativeIncidentWrites.WriteAsync(db, change.Entity, change.Original is null, change.Version, token);
        }
        foreach (var notice in inbox)
            await NativeIncidentWrites.InsertInboxAsync(db, notice, token);
        foreach (var audit in audits)
            await SecurityAuditWrites.AppendAsync(db, audit, token);
        if (tx is not null) await tx.CommitAsync(token);
        foreach (var change in changes)
            pending[(change.Entity.GetType(), change.Entity.Id)] = new(change.Entity, Snapshot(change.Entity), Version(change.Entity));
        inbox.Clear();
        audits.Clear();
    }
}
