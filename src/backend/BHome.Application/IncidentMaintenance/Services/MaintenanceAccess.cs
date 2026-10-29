using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// Who is calling and what they may see, always built from server data (never from request ids).
// A multi-role user only gets the scope of a role that is granted the permission being used.
public sealed class MaintenanceAccess(ICurrentUser user, ILocationAssignments assignments, TimeProvider clock)
{
    private static readonly TimeZoneInfo Vietnam = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");

    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, Vietnam).DateTime);
    public Guid UserId => user.UserId is { } id && id != Guid.Empty ? id : throw new MaintenanceNotFoundException();

    public bool Has(string permission, string role) =>
        RolePermissions.GetAllowedRoles(permission).Contains(role) && user.IsInRole(role);

    public async Task<MaintenanceViewer> ViewerAsync(string permission, CancellationToken cancellationToken)
    {
        IReadOnlyList<Guid> staffLocations = [];
        if (Has(permission, Roles.Staff))
        {
            var assigned = await assignments.ListAssignedLocationsAsync(UserId, Today, cancellationToken);
            staffLocations = assigned.Select(l => l.Id).ToArray();
        }
        return new MaintenanceViewer(UserId, Has(permission, Roles.Owner), Has(permission, Roles.Tenant), staffLocations);
    }

    // Owner-only actions are re-checked here as well as by the controller policy.
    public Guid RequireOwner(string permission) =>
        Has(permission, Roles.Owner) ? UserId : throw new MaintenanceNotFoundException();

    // Out-of-scope and missing records look the same to the caller (404).
    public static IncidentReport Visible(MaintenanceViewer viewer, IncidentReport? incident)
    {
        if (incident is null) throw new MaintenanceNotFoundException();
        var canSee = viewer.IsOwner
            || viewer.StaffLocationIds.Contains(incident.LocationId)
            || (viewer.IsTenant && incident.ReporterUserId == viewer.UserId);
        return canSee ? incident : throw new MaintenanceNotFoundException();
    }

    // Staff only see Work Orders assigned to them in a Location they are currently assigned to.
    public static MaintenanceWorkOrder Visible(MaintenanceViewer viewer, MaintenanceWorkOrder? order)
    {
        if (order is null) throw new MaintenanceNotFoundException();
        var canSee = viewer.IsOwner
            || (order.AssignedStaffUserId == viewer.UserId && viewer.StaffLocationIds.Contains(order.LocationId));
        return canSee ? order : throw new MaintenanceNotFoundException();
    }

    public static void Validate(object input)
    {
        if (!Validator.TryValidateObject(input, new ValidationContext(input), [], true))
            throw new MaintenanceValidationException("invalid_input");
    }
}
