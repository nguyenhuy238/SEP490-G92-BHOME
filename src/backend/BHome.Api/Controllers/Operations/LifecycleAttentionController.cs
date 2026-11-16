using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/owner-attention/lifecycle"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LifecycleAttentionController(LifecycleAttentionService service) : ControllerBase
{
    [HttpGet] public Task<LifecycleAttentionView> Get(CancellationToken t) => service.ReadAsync(t);
}
