using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PropertyLifecycleChecks(Compact24DbContext db) : IPropertyLifecycleChecks
{
    public async Task<LocationClosureCheck> ClosureAsync(Guid locationId, CancellationToken t)
    {
        if (!await db.Set<Native.Location>().AsNoTracking().AnyAsync(l => l.Id == locationId, t)) throw new PropertyException(404, "resource_not_found");
        var result = new List<LifecycleBlocker>();
        void Add(string code, int count) { if (count > 0) result.Add(new(code, count)); }
        // Available rooms may remain configured when a Location is deactivated; only rooms
        // that are still occupied or held represent an active operational obligation.
        var rooms = db.Set<Native.Room>().AsNoTracking().Where(r => r.LocationId == locationId);
        var roomIds = rooms.Select(r => r.Id);
        Add("operational_rooms", await rooms.CountAsync(r =>
            r.Status == (short)RoomStatus.Occupied || r.Status == (short)RoomStatus.OnHold, t));
        Add("unresolved_residents", await PostgresPropertyRepository.NativeUnresolvedResidents(db)
            .CountAsync(r => r.CurrentRoomId != null && roomIds.Contains(r.CurrentRoomId.Value), t));
        Add("active_or_pending_contracts", await db.Set<Native.Contract>().AsNoTracking().CountAsync(c => roomIds.Contains(c.RoomId) &&
            (c.Status == (short)ContractStatus.Active || c.Status == (short)ContractStatus.PendingSigning || c.Status == (short)ContractStatus.PendingActivation), t));
        Add("open_incidents", await db.Set<Native.IncidentReport>().AsNoTracking().CountAsync(i => i.LocationId == locationId &&
            (i.Status == "Submitted" || i.Status == "InProgress"), t));
        Add("open_tasks", await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM operational_tasks WHERE location_id={locationId} AND
            ((task_type IN ('GENERAL','METER_READ') AND status NOT IN ('2','3')) OR
             (task_type='WORK_ORDER' AND status NOT IN ('Verified','Cancelled')))
            """).SingleAsync(t));
        Add("pending_refunds", await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM refund_requests r WHERE r.status IN ('REQUESTED','APPROVED') AND
            (EXISTS(SELECT 1 FROM contracts c JOIN rooms rm ON rm.id=c.room_id WHERE c.id=r.source_deposit_contract_id AND rm.location_id={locationId}) OR
             EXISTS(SELECT 1 FROM payment_allocations a JOIN invoices i ON i.id=a.target_invoice_id WHERE a.source_payment_id=r.source_payment_id AND i.location_id={locationId}) OR
             EXISTS(SELECT 1 FROM payment_allocations a JOIN contracts c ON c.id=a.target_deposit_contract_id JOIN rooms rm ON rm.id=c.room_id WHERE a.source_payment_id=r.source_payment_id AND rm.location_id={locationId}) OR
             EXISTS(SELECT 1 FROM residents p JOIN rooms rm ON rm.id=p.current_room_id WHERE p.id=r.beneficiary_resident_id AND rm.location_id={locationId}))
            """).SingleAsync(t));
        Add("unsettled_holding_deposits", await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM contracts c JOIN rooms rm ON rm.id=c.room_id
            WHERE rm.location_id={locationId} AND c.contract_type='HOLDING' AND c.status IN (6,7)
              AND COALESCE((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
                  WHERE a.target_deposit_contract_id=c.id AND p.status='VERIFIED'),0)>
                  COALESCE((SELECT sum(r.requested_amount) FROM refund_requests r WHERE r.source_deposit_contract_id=c.id AND r.status='COMPLETED'),0)
            """).SingleAsync(t));
        Add("outstanding_invoices", await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM invoices i JOIN rooms r ON r.id=i.room_id
            WHERE r.location_id={locationId} AND i.status=1 AND
            i.base_total_amount+COALESCE((SELECT sum(a.approved_delta_amount) FROM invoice_adjustments a WHERE a.invoice_id=i.id AND a.status IN ('APPROVED','APPLIED')),0)>
            COALESCE((SELECT sum(p.amount) FROM payment_allocations p JOIN payments receipt ON receipt.id=p.source_payment_id WHERE p.target_invoice_id=i.id AND receipt.status='VERIFIED'),0)
            """).SingleAsync(t));
        return new(locationId, result.Count == 0, result);
    }
    public async Task<IReadOnlyList<string>> RoomBlockersAsync(Guid roomId, CancellationToken t,
        Guid? exceptContractId = null, bool includeActiveContracts = true)
    {
        var location = await db.Set<Native.Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => r.LocationId).SingleAsync(t);
        var codes = new List<string>();
        if (await db.Set<Native.IncidentReport>().AsNoTracking().AnyAsync(i => i.LocationId == location && (i.RoomId == roomId || i.RoomId == null) &&
            i.Severity == "EMERGENCY" && (i.Status == "Submitted" || i.Status == "InProgress"), t))
            codes.Add("unresolved_emergency");
        if (includeActiveContracts && await db.Set<Native.Contract>().AsNoTracking().AnyAsync(c => c.RoomId == roomId && c.Id != exceptContractId &&
            (c.Status == (short)ContractStatus.Active || c.Status == (short)ContractStatus.PendingSigning ||
             c.Status == (short)ContractStatus.PendingActivation), t))
            codes.Add("active_or_pending_contracts");
        if (await db.Set<Native.Asset>().AsNoTracking().AnyAsync(a => a.RoomId == roomId && (a.Status == (short)AssetStatus.NeedsRepair || a.Status == (short)AssetStatus.UnderRepair), t))
            codes.Add("asset_maintenance_required");
        return codes;
    }
    public async Task<StaffChangePreview> StaffChangeAsync(Guid locationId, CancellationToken t)
    {
        var responsibilities = new List<LifecycleBlocker>();
        foreach (var type in new[] { "GENERAL", "METER_READ", "WORK_ORDER" })
        {
            var count = await db.Database.SqlQuery<int>($"""
                SELECT count(*)::int AS "Value" FROM operational_tasks WHERE location_id={locationId} AND task_type={type}
                  AND CASE WHEN task_type='WORK_ORDER' THEN status NOT IN ('Verified','Cancelled') ELSE status NOT IN ('2','3') END
                """).SingleAsync(t);
            if (count > 0) responsibilities.Add(new(type, count));
        }
        var inspections = await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM contracts source
            JOIN contracts c ON c.id=(source.move_out->'current'->>'contractId')::uuid
            JOIN rooms r ON r.id=c.room_id
            WHERE r.location_id={locationId} AND source.move_out->'current'->>'inspectionStaffId' IS NOT NULL
              AND source.move_out->'current'->>'inspectedAt' IS NULL
              AND COALESCE((source.move_out->'current'->>'status')::int,0)<>{(int)MoveOutStatus.Completed}
            """).SingleAsync(t);
        if (inspections > 0) responsibilities.Add(new("MOVE_OUT_INSPECTION", inspections));
        return new(locationId, !responsibilities.Any(r => r.Code is "WORK_ORDER" or "MOVE_OUT_INSPECTION"), responsibilities);
    }
}
