using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/operational-work"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OperationalWorkController(OperationalWorkService service) : ControllerBase
{
    [HttpGet]
    public Task<OperationalWorkPage> List([FromQuery] OperationalWorkQuery query, CancellationToken token)
        => service.ReadAsync(query, token);
}
