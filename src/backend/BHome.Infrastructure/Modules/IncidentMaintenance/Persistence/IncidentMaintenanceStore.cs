using BHome.Application.IncidentMaintenance;
using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class IncidentMaintenanceStore(BHomeDbContext db, TimeProvider clock) : IIncidentMaintenanceStore
{
    private IQueryable<IncidentReport> Incidents => db.Set<IncidentReport>();
    private IQueryable<MaintenanceWorkOrder> WorkOrders => db.Set<MaintenanceWorkOrder>();
    private IQueryable<Asset> Assets => db.Set<Asset>();

    // ---------------- Commands ----------------

    public Task<IncidentReport?> FindIncidentAsync(Guid id, CancellationToken cancellationToken) =>
        Incidents.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task<MaintenanceWorkOrder?> FindWorkOrderAsync(Guid id, CancellationToken cancellationToken) =>
        WorkOrders.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

    public async Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersForIncidentAsync(Guid incidentId,
        CancellationToken cancellationToken) =>
        await WorkOrders.Where(x => x.IncidentReportId == incidentId).OrderBy(x => x.CreatedAt).ToListAsync(cancellationToken);

    public Task<bool> HasOpenWorkOrdersForAssetAsync(Guid assetId, Guid? excludingWorkOrderId,
        CancellationToken cancellationToken) =>
        WorkOrders.AnyAsync(x => x.AssetId == assetId && x.Id != excludingWorkOrderId &&
            x.Status != WorkOrderStatus.Verified && x.Status != WorkOrderStatus.Cancelled, cancellationToken);

    public Task<Asset?> FindAssetAsync(Guid id, CancellationToken cancellationToken) =>
        Assets.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task<RoomScope?> FindRoomAsync(Guid roomId, CancellationToken cancellationToken) =>
        db.Set<Room>().AsNoTracking().Where(x => x.Id == roomId)
            .Select(x => new RoomScope(x.Id, x.LocationId)).SingleOrDefaultAsync(cancellationToken);

    public Task<bool> LocationExistsAsync(Guid locationId, CancellationToken cancellationToken) =>
        db.Locations.AnyAsync(x => x.Id == locationId && x.IsActive, cancellationToken);

    public void Add(IncidentReport incident) => db.Add(incident);
    public void Add(MaintenanceWorkOrder workOrder) => db.Add(workOrder);

    public void Audit(Guid actorUserId, string action, string targetType, Guid targetId) =>
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = actorUserId,
            Event = action,
            TargetType = targetType,
            TargetId = targetId,
            Succeeded = true,
            OccurredAt = clock.GetUtcNow()
        });

    public async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new MaintenanceStateException("concurrent_update");
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: "23505" })
        {
            throw new MaintenanceStateException("duplicate_record");
        }
    }

    public async Task<IMaintenanceTransaction> BeginTransactionAsync(CancellationToken cancellationToken) =>
        new Transaction(await db.Database.BeginTransactionAsync(cancellationToken));

    // ---------------- Queries (scoped by the server-built viewer, capped by Take) ----------------

    public async Task<IReadOnlyList<IncidentSummary>> ListIncidentsAsync(MaintenanceViewer viewer, IncidentListQuery query,
        CancellationToken cancellationToken)
    {
        var rows = Incidents.AsNoTracking();
        if (!viewer.IsOwner)
            rows = rows.Where(x => viewer.StaffLocationIds.Contains(x.LocationId) ||
                (viewer.IsTenant && x.ReporterUserId == viewer.UserId));
        if (query.LocationId is { } locationId) rows = rows.Where(x => x.LocationId == locationId);
        if (query.Status is { } status) rows = rows.Where(x => x.Status == status);
        if (query.Severity is { } severity) rows = rows.Where(x => x.Severity == severity);
        if (query.OpenOnly) rows = rows.Where(x => x.Status == IncidentStatus.Submitted || x.Status == IncidentStatus.InProgress);

        return await rows.OrderByDescending(x => x.SubmittedAt).Take(query.Take)
            .Select(x => new IncidentSummary(x.Id, x.ReportCode, x.LocationId, x.RoomId, x.AssetId, x.Severity, x.Status,
                x.Summary, x.SubmittedAt, x.AcknowledgedAt, x.EscalatedAt != null && x.AcknowledgedAt == null))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<WorkOrderSummary>> ListWorkOrdersAsync(MaintenanceViewer viewer, WorkOrderListQuery query,
        CancellationToken cancellationToken)
    {
        var rows = WorkOrders.AsNoTracking();
        if (!viewer.IsOwner || query.Mine)
            rows = rows.Where(x => x.AssignedStaffUserId == viewer.UserId && viewer.StaffLocationIds.Contains(x.LocationId));
        if (query.LocationId is { } locationId) rows = rows.Where(x => x.LocationId == locationId);
        if (query.Status is { } status) rows = rows.Where(x => x.Status == status);

        return await rows.OrderByDescending(x => x.CreatedAt).Take(query.Take)
            .Join(Incidents, o => o.IncidentReportId, i => i.Id, (o, i) => new WorkOrderSummary(o.Id, o.IncidentReportId,
                i.ReportCode, o.LocationId, o.RoomId, o.AssetId, o.AssignedStaffUserId, o.Status, o.CostApprovedAt != null,
                o.DueAt, o.CreatedAt))
            .ToListAsync(cancellationToken);
    }

    // Owner-only (checked by the service). Rework count comes from the JSONB history, so it is counted in memory.
    public async Task<IReadOnlyList<MaintenanceHistoryItem>> MaintenanceHistoryAsync(MaintenanceHistoryQuery query,
        CancellationToken cancellationToken)
    {
        var rows = WorkOrders.AsNoTracking();
        if (query.LocationId is { } locationId) rows = rows.Where(x => x.LocationId == locationId);
        if (query.RoomId is { } roomId) rows = rows.Where(x => x.RoomId == roomId);
        if (query.AssetId is { } assetId) rows = rows.Where(x => x.AssetId == assetId);

        var items = await rows.OrderByDescending(x => x.CreatedAt).Take(query.Take)
            .Join(Incidents, o => o.IncidentReportId, i => i.Id, (o, i) => new { Order = o, i.ReportCode, i.Summary })
            .ToListAsync(cancellationToken);

        return items.Select(x => new MaintenanceHistoryItem(x.Order.Id, x.Order.IncidentReportId, x.ReportCode, x.Summary,
            x.Order.LocationId, x.Order.RoomId, x.Order.AssetId, x.Order.AssignedStaffUserId, x.Order.Status,
            x.Order.EstimatedCost, x.Order.ActualCost, x.Order.ResultSummary,
            x.Order.History.Count(h => h.Type == WorkOrderEntryType.Rework), x.Order.CreatedAt, x.Order.VerifiedAt)).ToArray();
    }

    public async Task<IReadOnlyList<IncidentReport>> UnacknowledgedEmergenciesAsync(DateTimeOffset submittedBefore, int limit,
        CancellationToken cancellationToken) =>
        await Incidents.Where(x => x.Severity == IncidentSeverity.OperationalEmergency && x.Status == IncidentStatus.Submitted &&
                x.AcknowledgedAt == null && x.EscalatedAt == null && x.SubmittedAt <= submittedBefore)
            .OrderBy(x => x.SubmittedAt).Take(limit).ToListAsync(cancellationToken);

    private sealed class Transaction(IDbContextTransaction transaction) : IMaintenanceTransaction
    {
        public Task CommitAsync(CancellationToken cancellationToken) => transaction.CommitAsync(cancellationToken);
        public ValueTask DisposeAsync() => transaction.DisposeAsync();
    }
}
