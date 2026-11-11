using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/residents/{id:guid}/identity-retention"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(8192)]
public sealed class IdentityRetentionController(IdentityRetentionService service) : ControllerBase
{
    [HttpGet] public Task<IdentityRetentionView> Get(Guid id, CancellationToken token) => service.GetAsync(id, token);
    [HttpPost("reviews")]
    public Task<IdentityRetentionView> Record(Guid id, IdentityRetentionInput input, CancellationToken token) =>
        service.RecordAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
