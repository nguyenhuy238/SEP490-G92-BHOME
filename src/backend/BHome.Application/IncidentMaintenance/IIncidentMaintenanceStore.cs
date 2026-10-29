using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

// Server-derived visibility. Built per permission from the caller's roles and current assignments.
public sealed record MaintenanceViewer(Guid UserId, bool IsOwner, bool IsTenant, IReadOnlyList<Guid> StaffLocationIds)
{
    public bool IsStaff => StaffLocationIds.Count > 0;
}

public sealed record RoomScope(Guid RoomId, Guid LocationId);

// Persistence port for FE-06. Implementations scope list queries by the viewer and cap result sizes.
public interface IIncidentMaintenanceStore
{
    Task<IncidentReport?> FindIncidentAsync(Guid id, CancellationToken cancellationToken);
    Task<MaintenanceWorkOrder?> FindWorkOrderAsync(Guid id, CancellationToken cancellationToken);
    Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersForIncidentAsync(Guid incidentId, CancellationToken cancellationToken);
    Task<bool> HasOpenWorkOrdersForAssetAsync(Guid assetId, Guid? excludingWorkOrderId, CancellationToken cancellationToken);
    Task<Asset?> FindAssetAsync(Guid id, CancellationToken cancellationToken);
    Task<RoomScope?> FindRoomAsync(Guid roomId, CancellationToken cancellationToken);
    Task<bool> LocationExistsAsync(Guid locationId, CancellationToken cancellationToken);
    Task<bool> AssetCodeExistsAsync(Guid locationId, string assetCode, Guid? excludingAssetId, CancellationToken cancellationToken);

    void Add(IncidentReport incident);
    void Add(MaintenanceWorkOrder workOrder);
    void Add(Asset asset);

    // GBR-13 / plan D15: high-impact decisions go to the existing append-only security audit.
    void Audit(Guid actorUserId, string action, string targetType, Guid targetId);

    // Throws MaintenanceStateException("concurrent_update") on optimistic concurrency conflicts.
    Task SaveAsync(CancellationToken cancellationToken);

    // Business change + notification job enqueue commit together.
    Task<IMaintenanceTransaction> BeginTransactionAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<IncidentSummary>> ListIncidentsAsync(MaintenanceViewer viewer, IncidentListQuery query,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkOrderSummary>> ListWorkOrdersAsync(MaintenanceViewer viewer, WorkOrderListQuery query,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<AssetSummary>> ListAssetsAsync(MaintenanceViewer viewer, AssetListQuery query,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<MaintenanceHistoryItem>> MaintenanceHistoryAsync(MaintenanceHistoryQuery query,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<IncidentReport>> UnacknowledgedEmergenciesAsync(DateTimeOffset submittedBefore, int limit,
        CancellationToken cancellationToken);
}

public interface IMaintenanceTransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken);
}

// Recipients and eligibility from trusted server state (active accounts, current Location assignments).
public interface IMaintenanceDirectory
{
    Task<IReadOnlyList<Guid>> OwnerUserIdsAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<Guid>> StaffAssignedToLocationAsync(Guid locationId, CancellationToken cancellationToken);
}

// Tenancy belongs to TenantContracts (BH-13/16). Until it exists the adapter returns no Rooms.
public interface ITenantRoomScope
{
    Task<IReadOnlyList<RoomScope>> ActiveRoomsAsync(Guid tenantUserId, CancellationToken cancellationToken);
}

// DBR-10 / GBR-12: maintenance cost -> OperatingExpense (FE-08 owns reporting). Idempotent by SourceKey.
public sealed record MaintenanceExpense(string SourceKey, Guid LocationId, Guid? RoomId, Guid? AssetId,
    Guid IncidentReportId, Guid? WorkOrderId, decimal Amount, DateOnly IncurredOn, string Description,
    Guid RecordedByUserId);

public interface IMaintenanceExpenseRecorder
{
    Task RecordAsync(MaintenanceExpense expense, CancellationToken cancellationToken);
}

// The record is outside the caller's scope or does not exist. Always mapped to 404.
public sealed class MaintenanceNotFoundException() : Exception("Không tìm thấy dữ liệu.");

// OQ-04 is open: thresholds are configuration, not hard-coded policy (UC-27 A1).
public sealed class IncidentMaintenanceOptions
{
    public const string Section = "IncidentMaintenance";
    public int ReminderMinutes { get; set; } = 15;
    public int OverdueMinutes { get; set; } = 30;
    public bool IsValid() => ReminderMinutes is >= 1 and <= 1440 && OverdueMinutes > ReminderMinutes && OverdueMinutes <= 2880;
}
