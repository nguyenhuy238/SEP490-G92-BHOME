using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

// A protected foundation probe, removed/replaced when the identity feature lands.
[ApiController]
[Route("api/v1/session")]
public sealed class FoundationController(ICurrentUser user) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Permissions.Account.ViewOwn)]
    public ActionResult<SessionResponse> Get() => Ok(new SessionResponse(user.UserId));
}

public sealed record SessionResponse(Guid? UserId);
