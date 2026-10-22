using BHome.Application.IdentityAccess;

namespace BHome.Api.IdentityAccess;

internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId => Guid.TryParse(accessor.HttpContext?.User.FindFirst("sub")?.Value, out var id) ? id : null;
    public bool IsInRole(string role) => accessor.HttpContext?.User.IsInRole(role) == true;
}
