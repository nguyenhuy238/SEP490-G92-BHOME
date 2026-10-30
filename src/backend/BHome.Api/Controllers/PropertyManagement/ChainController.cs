using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Route("api/v1/chain"), Authorize(Policy = Permissions.Property.Manage)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(16384)]
public sealed class ChainController(PropertyService service) : ControllerBase
{
    [HttpGet]
    public Task<ChainDto> Get(CancellationToken t) => service.GetChainAsync(t);

    [HttpPut]
    public Task<ChainDto> Rename(ChainWrite input, CancellationToken t) => service.RenameChainAsync(input, t);
}
