using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

// UC-05: Staff condition note. Asset CRUD lives in PropertyManagement's AssetsController.
[ApiController, Route("api/v1/assets")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AssetConditionController(AssetService assets) : ControllerBase
{
    [HttpPost("{id:guid}/condition"), Authorize(Policy = Permissions.Assets.UpdateCondition)]
    public Task<AssetSummary> Condition(Guid id, AssetConditionInput input, CancellationToken t) =>
        assets.UpdateConditionAsync(id, input, t);
}
