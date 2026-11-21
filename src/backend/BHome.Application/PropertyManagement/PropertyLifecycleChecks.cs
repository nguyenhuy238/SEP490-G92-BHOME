namespace BHome.Application.PropertyManagement;

public sealed record LifecycleBlocker(string Code, int Count);
public sealed record LocationClosureCheck(Guid LocationId, bool CanClose, IReadOnlyList<LifecycleBlocker> Blockers);
public sealed record StaffChangePreview(Guid LocationId, bool CanRemove, IReadOnlyList<LifecycleBlocker> OpenResponsibilities);
public interface IPropertyLifecycleChecks
{
    Task<LocationClosureCheck> ClosureAsync(Guid locationId, CancellationToken t);
    Task<IReadOnlyList<string>> RoomBlockersAsync(Guid roomId, CancellationToken t);
    Task<StaffChangePreview> StaffChangeAsync(Guid locationId, CancellationToken t);
}
