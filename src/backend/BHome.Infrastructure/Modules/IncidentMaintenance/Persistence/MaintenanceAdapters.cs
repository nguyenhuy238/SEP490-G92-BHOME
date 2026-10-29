using BHome.Application.IncidentMaintenance;
using BHome.Domain.FinanceReporting;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// Active Owner accounts and Staff with a Location assignment covering today (Vietnam business date).
internal sealed class MaintenanceDirectory(BHomeDbContext db, TimeProvider clock) : IMaintenanceDirectory
{
    private static readonly TimeZoneInfo Vietnam = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");

    public async Task<IReadOnlyList<Guid>> OwnerUserIdsAsync(CancellationToken cancellationToken) =>
        await UsersInRole(Roles.Owner).Take(50).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Guid>> StaffAssignedToLocationAsync(Guid locationId, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), Vietnam).DateTime);
        return await UsersInRole(Roles.Staff)
            .Where(id => db.StaffLocationAssignments.Any(a => a.StaffUserId == id && a.LocationId == locationId &&
                a.StartDate <= today && today <= a.EndDate))
            .Take(100).ToListAsync(cancellationToken);
    }

    private IQueryable<Guid> UsersInRole(string role) =>
        db.Users.AsNoTracking()
            .Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
                db.Roles.Any(r => r.Id == ur.RoleId && r.Name == role)))
            .Select(u => u.Id);
}

// Writes the OperatingExpense in the caller's DbContext/transaction; SourceKey prevents duplicates.
internal sealed class MaintenanceExpenseRecorder(BHomeDbContext db) : IMaintenanceExpenseRecorder
{
    public async Task RecordAsync(MaintenanceExpense expense, CancellationToken cancellationToken)
    {
        if (await db.Set<OperatingExpense>().AnyAsync(x => x.SourceKey == expense.SourceKey, cancellationToken)) return;
        db.Add(new OperatingExpense(expense.SourceKey, expense.LocationId, expense.RoomId, expense.AssetId,
            expense.IncidentReportId, expense.WorkOrderId, expense.Amount, expense.IncurredOn, expense.Description,
            expense.RecordedByUserId));
    }
}

// TenantContracts (BH-13/16) has no tenancy data yet, so no Tenant can report until it is implemented.
internal sealed class UnavailableTenantRoomScope : ITenantRoomScope
{
    public Task<IReadOnlyList<RoomScope>> ActiveRoomsAsync(Guid tenantUserId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<RoomScope>>([]);
}
