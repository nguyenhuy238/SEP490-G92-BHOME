using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/locations/{locationId:guid}/capital-assets"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class CapitalAssetsController(CapitalAssetService service) : ControllerBase
{
    [HttpGet]
    public Task<CapitalAssets> Read(Guid locationId, CancellationToken token) => service.ReadAsync(locationId, token);
}
