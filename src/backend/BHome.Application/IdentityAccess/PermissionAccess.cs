using BHome.Domain.IdentityAccess;

namespace BHome.Application.IdentityAccess;

public sealed class PermissionAccess(ICurrentUser user, ResourceAccess resources)
{
    // Function permission only. This does not authorize an arbitrary record or response field.
    public bool HasPermission(string? permission) => user.UserId is { } id && id != Guid.Empty &&
        RolePermissions.GetAllowedRoles(permission).Any(user.IsInRole);

    // Scope must come from persistence, never client-supplied owner/location/tenant claims.
    public Task<bool> CanAccessAsync(string? permission, ResourceScope scope, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return resources.CanAccessAsync(scope, RolePermissions.GetAllowedRoles(permission), cancellationToken);
    }
}
