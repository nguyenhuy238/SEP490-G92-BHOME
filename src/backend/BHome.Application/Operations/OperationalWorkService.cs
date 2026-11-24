using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed class OperationalWorkQuery
{
    [Range(1, 1000000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? IncidentId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid? StaffUserId { get; set; }
    public Guid? RecordedStaffUserId { get; set; }
    public bool? HasResponsibility { get; set; }
    public DateTimeOffset? DueFrom { get; set; }
    public DateTimeOffset? DueTo { get; set; }
    public string? Kind { get; set; }
    public string? View { get; set; }
    public string? Source { get; set; }
    public string? WorkType { get; set; }
    public string? Phase { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    [StringLength(200)] public string? Search { get; set; }
    public bool? IsOverdue { get; set; }
    public bool? Maintenance { get; set; }
    public bool? Verification { get; set; }
}

public sealed record OperationalWorkItem(Guid Id, string Kind, string Title, string Source, string WorkType,
    Guid LocationId, string? LocationName, Guid? RoomId, string? RoomNumber, string? CommonArea,
    string? AssetName, string Priority, string Status, string Phase, string NextAction, string? StaffName,
    DateTimeOffset? DueAt, DateTimeOffset CreatedAt, bool IsOverdue, Guid? ActiveWorkOrderId, int WorkOrderCount,
    Guid? IncidentId = null, string? IncidentStatus = null, string? IncidentTitle = null,
    string? WorkOrderStatus = null, int OpenWorkOrderCount = 0, int VerifiedWorkOrderCount = 0);
public sealed record OperationalWorkCounts(int Total, int NeedsOwner, int Active, int Closed, int Overdue, int Verification);
public sealed record OperationalWorkPage(IReadOnlyList<OperationalWorkItem> Items, int Page, int PageSize,
    int TotalCount, OperationalWorkCounts Counts);

public interface IOperationalWorkRepository
{
    Task<OperationalWorkPage> ReadAsync(OperationalWorkQuery query, DateTimeOffset now, CancellationToken token);
}

public sealed class OperationalWorkService(IOperationalWorkRepository repository, ICurrentUser user, TimeProvider clock)
{
    public Task<OperationalWorkPage> ReadAsync(OperationalWorkQuery query, CancellationToken token)
    {
        if (user.UserId is null) throw new OperationsException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        query.View = query.View?.Trim().ToLowerInvariant();
        if (query.View is not (null or "" or "reports" or "work"))
            throw new OperationsException(400, "invalid_operational_work_view");
        if (query.DueFrom > query.DueTo)
            throw new OperationsException(400, "invalid_operational_work_date_range");
        return repository.ReadAsync(query, clock.GetUtcNow(), token);
    }
}
