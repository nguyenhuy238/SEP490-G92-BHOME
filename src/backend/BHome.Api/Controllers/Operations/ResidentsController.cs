using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/residents"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(16384)]
public sealed class ResidentsController(ResidentAdministrationService service) : ControllerBase
{
    [HttpGet] public Task<OperationsPage<ResidentAdministrationView>> List([FromQuery] ResidentAdministrationQuery query, CancellationToken t) => service.ListAsync(query, t);
    [HttpGet("{id:guid}")] public Task<ResidentAdministrationView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPut("{id:guid}/workspace-label")] public Task<ResidentAdministrationView> Update(Guid id, ResidentLabelUpdate input, CancellationToken t) => service.UpdateAsync(id, input, t);
}
