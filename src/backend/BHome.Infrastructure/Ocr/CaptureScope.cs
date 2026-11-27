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

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureScope(BHomePersistenceContext db, ICurrentUser user, TimeProvider clock)
{
    public Guid UserId => user.UserId ?? Guid.Empty;
    public bool IsStaff => user.IsInRole(Roles.Staff);
    public DateOnly Today => clock.BusinessToday();
    internal IQueryable<Guid> EligibleStaff => db.EligibleStaffIds(Today);
    public IQueryable<Location> VisibleLocations => db.Locations.Where(l => l.IsActive &&
        (user.IsInRole(Roles.Owner) ||
        (user.IsInRole(Roles.Staff) && EligibleStaff.Contains(UserId) && db.StaffLocationAssignments.Any(a => a.LocationId == l.Id && a.StaffUserId == UserId &&
            a.StartDate <= Today && a.EndDate >= Today))));
    public IQueryable<Room> VisibleRooms => db.Set<Room>().Where(r => VisibleLocations.Any(l => l.Id == r.LocationId));
    public IQueryable<OperationalTask> VisibleTasks => db.Set<OperationalTask>()
        .Where(t => t.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && VisibleRooms.Any(r => r.Id == t.Meter.RoomId) &&
            (t.Purpose == ReadingPurpose.Periodic || t.AutomationPlanId == null || user.IsInRole(Roles.Owner) || t.AssignedStaffUserId == UserId));
    internal async Task<bool> CanCorrectAsync(OperationalTask task, Meter meter, MeterReading reading, CancellationToken t)
    {
        if (!IsStaff || !meter.IsActive || task.Status != MeterTaskStatus.Completed || task.ReadingDate > Today) return false;
        // Changing a reading already used as a subsequent physical baseline would
        // invalidate that reading's previous value and its audit evidence.
        if (await db.Set<MeterReading>().AnyAsync(r => r.MeterId == meter.Id && r.Id != reading.Id &&
            r.ConfirmedAt >= reading.ConfirmedAt, t)) return false;
        if (task.BillingPeriod != null && await db.Set<Invoice>().AnyAsync(i => i.Status == InvoiceStatus.Final &&
            i.RoomId == meter.RoomId && i.BillingPeriod == task.BillingPeriod, t)) return false;
        if (await (from line in db.Set<InvoiceLine>()
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
                a.Title.StartsWith("Bàn giao vào phòng") && (a.Status != MeterTaskStatus.InProgress || a.AssignedStaffUserId != UserId), t)) return false;
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
}
