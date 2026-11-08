using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PropertyLifecycleChecks(Compact24DbContext db) : IPropertyLifecycleChecks
{
    public async Task<LocationClosureCheck> ClosureAsync(Guid locationId, CancellationToken t)
    {
        if (!await db.Locations.AnyAsync(l => l.Id == locationId, t)) throw new PropertyException(404, "resource_not_found");
        var result = new List<LifecycleBlocker>();
        void Add(string code, int count) { if (count > 0) result.Add(new(code, count)); }
        Add("operational_rooms", await db.Set<Room>().CountAsync(r => r.LocationId == locationId && r.Status != RoomStatus.Unavailable, t));
        Add("unresolved_residents", await PostgresPropertyRepository.UnresolvedResidents(db).CountAsync(r => r.Room.LocationId == locationId, t));
        Add("active_or_pending_contracts", await db.Set<Contract>().CountAsync(c => c.Room.LocationId == locationId &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation), t));
        Add("open_incidents", await db.Set<IncidentReport>().CountAsync(i => i.LocationId == locationId &&
            (i.Status == IncidentStatus.Submitted || i.Status == IncidentStatus.InProgress), t));
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
    public async Task<IReadOnlyList<string>> RoomBlockersAsync(Guid roomId, CancellationToken t)
    {
        var location = await db.Set<Room>().Where(r => r.Id == roomId).Select(r => r.LocationId).SingleAsync(t);
        var codes = new List<string>();
        if (await db.Set<IncidentReport>().AnyAsync(i => i.LocationId == location && (i.RoomId == roomId || i.RoomId == null) &&
            i.Severity == IncidentSeverity.Emergency && (i.Status == IncidentStatus.Submitted || i.Status == IncidentStatus.InProgress), t))
            codes.Add("unresolved_emergency");
        if (await db.Set<Asset>().AnyAsync(a => a.RoomId == roomId && (a.Status == AssetStatus.NeedsRepair || a.Status == AssetStatus.UnderRepair), t))
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
        var inspections = await db.Set<ContractMoveOut>().CountAsync(m => m.InspectionStaffId != null && m.InspectedAt == null &&
            m.Status != MoveOutStatus.Completed && db.Set<Contract>().Any(c => c.Id == m.ContractId && c.Room.LocationId == locationId), t);
        if (inspections > 0) responsibilities.Add(new("MOVE_OUT_INSPECTION", inspections));
        return new(locationId, !responsibilities.Any(r => r.Code is "WORK_ORDER" or "MOVE_OUT_INSPECTION"), responsibilities);
    }
}
