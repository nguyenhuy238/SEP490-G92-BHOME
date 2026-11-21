using BHome.Application.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/personal-data-requests"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(16384)]
public sealed class PersonalDataRequestsController(PersonalDataRequestService service) : ControllerBase
{
    [HttpGet] public Task<OperationsPage<PersonalDataRequestView>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.ListAsync(page, pageSize, t);
    [HttpPut("{id:guid}")] public Task<PersonalDataRequestView> Create(Guid id, PersonalDataRequestCreate input, CancellationToken t) => service.CreateAsync(id, input, t);
    [HttpPost("{userId:guid}/{id:guid}/decisions")] public Task<PersonalDataRequestView> Decide(Guid userId, Guid id, PersonalDataRequestDecision input, CancellationToken t) => service.DecideAsync(userId, id, input, t);
}
