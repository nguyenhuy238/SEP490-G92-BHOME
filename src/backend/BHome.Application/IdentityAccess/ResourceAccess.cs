using BHome.Domain.IdentityAccess;

namespace BHome.Application.IdentityAccess;

// Values MUST come from a server-side resource lookup, never a request body or JWT location claim.
public sealed record ResourceScope(Guid OwnerUserId, Guid? LocationId, Guid? TenantUserId);

public interface IStaffLocationAccess
{
    Task<bool> IsAssignedAsync(Guid staffId, Guid ownerId, Guid locationId, CancellationToken cancellationToken);
}

public sealed class ResourceAccess(ICurrentUser user, IStaffLocationAccess staffLocations)
{
    public async Task<bool> CanAccessAsync(ResourceScope scope, IReadOnlyCollection<string> allowedRoles,
        CancellationToken cancellationToken = default)
    {
        if (user.UserId is not { } id || id == Guid.Empty) return false;
        // Scope must be satisfied through a role permitted for THIS use case, even for multi-role users.
        bool HasRole(string role) => allowedRoles.Contains(role) && user.IsInRole(role);
        if (HasRole(Roles.Owner) && scope.OwnerUserId == id) return true;
        if (HasRole(Roles.Tenant) && scope.TenantUserId == id) return true;
        return HasRole(Roles.Staff) && scope.LocationId is { } locationId &&
            await staffLocations.IsAssignedAsync(id, scope.OwnerUserId, locationId, cancellationToken);
    }
}
