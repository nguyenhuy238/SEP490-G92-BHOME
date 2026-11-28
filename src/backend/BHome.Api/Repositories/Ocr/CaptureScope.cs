using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureScope(BHomePersistenceContext db, ICurrentUser user, TimeProvider clock)
{
    public Guid UserId => user.UserId ?? Guid.Empty;
    public bool IsStaff => user.IsInRole(Roles.Staff);
    public DateOnly Today => clock.BusinessToday();
    internal IQueryable<Guid> EligibleStaff => db is Compact24DbContext compact
        ? StaffEmploymentEligibility.EligibleIds(compact, Today)
        : db.Users.Where(u => u.IsActive).Select(u => u.Id);
    public IQueryable<Location> VisibleLocations => db.Locations.Where(l => l.IsActive &&
        (user.IsInRole(Roles.Owner) ||
        (user.IsInRole(Roles.Staff) && EligibleStaff.Contains(UserId) && db.StaffLocationAssignments.Any(a => a.LocationId == l.Id && a.StaffUserId == UserId &&
            a.StartDate <= Today && a.EndDate >= Today))));
    public IQueryable<Room> VisibleRooms => db.Set<Room>().Where(r => VisibleLocations.Any(l => l.Id == r.LocationId));
    public IQueryable<OperationalTask> VisibleTasks => db.Set<OperationalTask>()
        .Where(t => t.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && VisibleRooms.Any(r => r.Id == t.Meter.RoomId) &&
            (t.Purpose != ReadingPurpose.Initial || t.ContractId == null || t.MeterStatus == MeterTaskStatus.Completed ||
                db.Set<Contract>().Any(c => c.Id == t.ContractId && c.Status == ContractStatus.Active)) &&
            (t.Purpose == ReadingPurpose.Periodic || t.AutomationPlanId == null || user.IsInRole(Roles.Owner) || t.AssignedStaffUserId == UserId));
    internal IQueryable<BHome.Domain.Locations.Location> NativeLocations
    {
        get
        {
            var compact = (Compact24DbContext)db;
            var owner = user.IsInRole(Roles.Owner);
            var staff = user.IsInRole(Roles.Staff);
            var assignments = db.Database.SqlQuery<Guid>($"""
                SELECT l.id AS "Value" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
                WHERE (a->>'staffUserId')::uuid={UserId} AND (a->>'startDate')::date<={Today} AND (a->>'endDate')::date>={Today}
                """);
            return compact.Set<BHome.Domain.Locations.Location>().AsNoTracking().Where(l => l.IsActive &&
                (owner || staff && EligibleStaff.Contains(UserId) && assignments.Contains(l.Id)));
        }
    }
    internal IQueryable<BHome.Domain.PropertyManagement.Room> NativeRooms => ((Compact24DbContext)db).Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking()
        .Where(r => NativeLocations.Any(l => l.Id == r.LocationId));
    internal IQueryable<BHome.Domain.Billing.OperationalTask> NativeTasks
    {
        get
        {
            var owner = user.IsInRole(Roles.Owner);
            var compact = (Compact24DbContext)db;
            return compact.Set<BHome.Domain.Billing.OperationalTask>().FromSqlInterpolated($"""
                SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND
                (COALESCE((task_data->'state'->>'purpose')::int,-1)<>0 OR contract_id IS NULL OR status='2' OR
                    EXISTS(SELECT 1 FROM contracts c WHERE c.id=operational_tasks.contract_id AND c.status={(short)ContractStatus.Active})) AND
                ((task_data->'state'->>'purpose')::int=1 OR task_data->'state'->>'automationPlanId' IS NULL OR {owner} OR assigned_user_id={UserId})
                """).AsNoTracking().Where(t => compact.Set<BHome.Domain.Billing.Meter>().Any(m => m.Id == t.MeterId && NativeRooms.Any(r => r.Id == m.RoomId)));
        }
    }
    internal Task<bool> RoomVisibleAsync(Guid? id, CancellationToken t) => db is Compact24DbContext
        ? NativeRooms.AnyAsync(r => r.Id == id, t) : VisibleRooms.AnyAsync(r => r.Id == id, t);
    internal Task<bool> LocationVisibleAsync(Guid id, CancellationToken t) => db is Compact24DbContext
        ? NativeLocations.AnyAsync(l => l.Id == id, t) : VisibleLocations.AnyAsync(l => l.Id == id, t);
    internal Task<Guid?> TaskLocationAsync(Guid id, CancellationToken t) => db is Compact24DbContext
        ? NativeTasks.Where(x => x.Id == id).Select(x => x.LocationId).SingleOrDefaultAsync(t)
        : VisibleTasks.Where(x => x.Id == id).Select(x => (Guid?)x.RequiredLocationId).SingleOrDefaultAsync(t);
    internal Task<Guid?> TaskMeterAsync(Guid id, CancellationToken t) => db is Compact24DbContext
        ? NativeTasks.Where(x => x.Id == id).Select(x => x.MeterId).SingleOrDefaultAsync(t)
        : VisibleTasks.Where(x => x.Id == id).Select(x => x.MeterId).SingleOrDefaultAsync(t);
    internal async Task<OperationalTask?> ReadTaskAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext) return await VisibleTasks.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, t);
        var row = await NativeTasks.SingleOrDefaultAsync(x => x.Id == id, t);
        return row is null ? null : NativeCaptureReads.Task(row);
    }
    internal async Task<OperationalTask?> LockTaskAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext compact) return await db.Locked<OperationalTask>(id).SingleOrDefaultAsync(t);
        var row = await compact.Set<BHome.Domain.Billing.OperationalTask>().FromSqlInterpolated($"SELECT * FROM operational_tasks WHERE id={id} AND task_type='METER_READ' FOR UPDATE")
            .AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : NativeCaptureReads.Task(row);
    }
    internal async Task<Meter> MeterAsync(Guid? id, CancellationToken t, bool locked = false)
    {
        if (db is not Compact24DbContext compact) return locked ? await db.Locked<Meter>(id!.Value).SingleAsync(t) : await db.Set<Meter>().AsNoTracking().SingleAsync(m => m.Id == id, t);
        var query = locked ? compact.Set<BHome.Domain.Billing.Meter>().FromSqlInterpolated($"SELECT * FROM meters WHERE id={id} FOR UPDATE") : compact.Set<BHome.Domain.Billing.Meter>();
        return await query.AsNoTracking().SingleAsync(m => m.Id == id, t);
    }
    internal async Task<MeterReading?> TaskReadingAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext compact) return await db.Set<MeterReading>().SingleOrDefaultAsync(r => r.TaskId == id, t);
        return await compact.Set<BHome.Domain.Billing.MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.OperationalTaskId == id, t);
    }
    internal async Task<MeterReading?> LatestReadingAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext compact) return await db.Set<MeterReading>().Where(r => r.MeterId == id).OrderByDescending(r => r.ConfirmedAt).FirstOrDefaultAsync(t);
        return await compact.Set<BHome.Domain.Billing.MeterReading>().AsNoTracking().Where(r => r.MeterId == id).OrderByDescending(r => r.ConfirmedAt).FirstOrDefaultAsync(t);
    }
    internal Task<MeterEvidence?> LockEvidenceAsync(Guid id, CancellationToken t) => db is Compact24DbContext compact
        ? NativeCaptureReads.LockedEvidenceAsync(compact, id, t) : db.Locked<MeterEvidence>(id).SingleOrDefaultAsync(t);
    internal async Task<bool> CanCorrectAsync(OperationalTask task, Meter meter, MeterReading reading, CancellationToken t)
    {
        if (!IsStaff || !meter.IsActive || task.MeterStatus != MeterTaskStatus.Completed || task.ReadingDate > Today) return false;
        if (db is Compact24DbContext compact) return await CanCorrectNativeAsync(compact, task, meter, reading, t);
        // Changing a reading already used as a subsequent physical baseline would
        // invalidate that reading's previous value and its audit evidence.
        if (await db.Set<MeterReading>().AnyAsync(r => r.MeterId == meter.Id && r.Id != reading.Id &&
            r.ConfirmedAt >= reading.ConfirmedAt, t)) return false;
        if (task.BillingPeriod != null && await db.Set<Invoice>().AnyAsync(i => i.Status == InvoiceStatus.Final &&
            i.RoomId == meter.RoomId && i.BillingPeriod == task.BillingPeriod, t)) return false;
        if (await (from line in db.Set<InvoiceItem>()
                   join invoice in db.Set<Invoice>() on line.InvoiceId equals invoice.Id
                   where invoice.Status == InvoiceStatus.Final && line.MeterReadingId == reading.Id
                   select line.Id).AnyAsync(t)) return false;
        if (await db.Set<ContractHandover>().AnyAsync(h => h.Status == ContractHandoverStatus.Confirmed &&
            (h.ElectricityReadingId == reading.Id || h.WaterReadingId == reading.Id), t)) return false;
        if (await db.Set<ContractMoveOut>().AnyAsync(m => m.InspectedAt != null &&
            (m.ElectricityReadingId == reading.Id || m.WaterReadingId == reading.Id), t)) return false;
        if (db is Compact24DbContext && await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                WHERE c.room_id={meter.RoomId} AND h->>'recordType'='SettlementReceivableV1'
                  AND (h->'state'->'utility'->'baseline'->>'readingId'={reading.Id.ToString()}
                    OR h->'state'->'utility'->'final'->>'readingId'={reading.Id.ToString()})) AS "Value"
            """).SingleAsync(t)) return false;
        if (task.Purpose == ReadingPurpose.Initial && task.ContractId is { } initialContract)
        {
            if (!await db.Set<Contract>().AnyAsync(c => c.Id == initialContract && c.Status == ContractStatus.Active, t)) return false;
            if (await db.Set<OperationalTask>().AnyAsync(a => a.ContractId == initialContract && a.Kind == OperationalTaskKind.AdHoc &&
                a.TaskTitle.StartsWith("Bàn giao vào phòng") && (a.MeterStatus != MeterTaskStatus.InProgress || a.AssignedStaffUserId != UserId), t)) return false;
            if (await db.Set<ContractHandover>().AnyAsync(h => h.ContractId == initialContract &&
                h.Status == ContractHandoverStatus.Confirmed, t)) return false;
            if (db is Compact24DbContext && await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM contracts WHERE id={initialContract}
                    AND (handover->'preparation'->>'ownerSignature' IS NOT NULL
                        OR handover->'preparation'->>'ownerReadyAt' IS NOT NULL
                        OR handover->'preparation'->>'staffSubmittedAt' IS NOT NULL)) AS "Value"
                """).SingleAsync(t)) return false;
        }
        if (task.Purpose == ReadingPurpose.Final && task.ContractId is { } finalContract &&
            !await db.Set<ContractMoveOut>().AnyAsync(m => m.ContractId == finalContract && m.Status == MoveOutStatus.Approved &&
                m.InspectedAt == null && (m.InspectionStaffId == null || m.InspectionStaffId == UserId), t)) return false;
        return true;
    }

    private async Task<bool> CanCorrectNativeAsync(Compact24DbContext compact, OperationalTask task, Meter meter, MeterReading reading, CancellationToken t)
    {
        if (await compact.Set<BHome.Domain.Billing.MeterReading>().AnyAsync(r => r.MeterId == meter.Id && r.Id != reading.Id && r.ConfirmedAt >= reading.ConfirmedAt, t)) return false;
        if (task.BillingPeriod != null && await compact.Set<BHome.Domain.Billing.Invoice>().AnyAsync(i => i.Status == InvoiceStatus.Final &&
            i.RoomId == meter.RoomId && i.BillingPeriod == task.BillingPeriod, t)) return false;
        if (await (from line in compact.Set<BHome.Domain.Billing.InvoiceItem>()
                   join invoice in compact.Set<BHome.Domain.Billing.Invoice>() on line.InvoiceId equals invoice.Id
                   where invoice.Status == InvoiceStatus.Final && line.MeterReadingId == reading.Id
                   select line.Id).AnyAsync(t)) return false;
        var id = reading.Id.ToString();
        if (await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts WHERE
                ((handover->'current'->>'status')::int=2 AND (handover->'current'->>'electricityReadingId'={id} OR handover->'current'->>'waterReadingId'={id})) OR
                (move_out->'current'->>'inspectedAt' IS NOT NULL AND (move_out->'current'->>'electricityReadingId'={id} OR move_out->'current'->>'waterReadingId'={id}))) AS "Value"
            """).SingleAsync(t)) return false;
        if (await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                WHERE c.room_id={meter.RoomId} AND h->>'recordType'='SettlementReceivableV1'
                  AND (h->'state'->'utility'->'baseline'->>'readingId'={id} OR h->'state'->'utility'->'final'->>'readingId'={id})) AS "Value"
            """).SingleAsync(t)) return false;
        if (task.Purpose == ReadingPurpose.Initial && task.ContractId is { } initialContract)
        {
            if (!await compact.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(c => c.Id == initialContract && c.Status == ContractStatus.Active, t)) return false;
            if (await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE contract_id={initialContract} AND task_type='GENERAL'
                    AND COALESCE((task_data->'state'->>'kind')::int,1)=1 AND title LIKE 'Bàn giao vào phòng%'
                    AND (status<>'1' OR assigned_user_id IS DISTINCT FROM {UserId})) AS "Value"
                """).SingleAsync(t)) return false;
            if (await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM contracts WHERE id={initialContract} AND ((handover->'current'->>'status')::int=2
                    OR handover->'preparation'->>'ownerSignature' IS NOT NULL OR handover->'preparation'->>'ownerReadyAt' IS NOT NULL
                    OR handover->'preparation'->>'staffSubmittedAt' IS NOT NULL)) AS "Value"
                """).SingleAsync(t)) return false;
        }
        if (task.Purpose == ReadingPurpose.Final && task.ContractId is { } finalContract && !await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts WHERE id={finalContract} AND (move_out->'current'->>'status')::int=1
                AND move_out->'current'->>'inspectedAt' IS NULL AND (move_out->'current'->>'inspectionStaffId' IS NULL
                    OR (move_out->'current'->>'inspectionStaffId')::uuid={UserId})) AS "Value"
            """).SingleAsync(t)) return false;
        return true;
    }
}
