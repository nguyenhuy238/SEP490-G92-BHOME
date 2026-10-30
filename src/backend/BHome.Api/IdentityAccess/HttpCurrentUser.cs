using BHome.Application.IdentityAccess;

namespace BHome.Api.IdentityAccess;

internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId => accessor.HttpContext?.User.Identity?.IsAuthenticated == true &&
        Guid.TryParse(accessor.HttpContext.User.FindFirst("sub")?.Value, out var id) ? id : null;
    public bool IsInRole(string role) => accessor.HttpContext?.User.Identity?.IsAuthenticated == true &&
        accessor.HttpContext.User.IsInRole(role);
}
