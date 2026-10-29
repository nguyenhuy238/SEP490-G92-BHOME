using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

// UC-05 Asset Management (screen 1.1.2).
[ApiController, Route("api/v1/assets")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AssetsController(AssetService assets) : ControllerBase
{
    [HttpGet, Authorize(Policy = Permissions.Assets.View)]
    public Task<IReadOnlyList<AssetSummary>> List([FromQuery] AssetListQuery query, CancellationToken t) => assets.ListAsync(query, t);

    [HttpPost, Authorize(Policy = Permissions.Assets.Manage)]
    public async Task<ActionResult<AssetSummary>> Create(CreateAssetInput input, CancellationToken t)
    {
        var created = await assets.CreateAsync(input, t);
        return Created($"/api/v1/assets/{created.Id}", created);
    }

    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Assets.Manage)]
    public Task<AssetSummary> Update(Guid id, UpdateAssetInput input, CancellationToken t) => assets.UpdateAsync(id, input, t);

    [HttpPost("{id:guid}/retire"), Authorize(Policy = Permissions.Assets.Manage)]
    public Task<AssetSummary> Retire(Guid id, CancellationToken t) => assets.RetireAsync(id, t);

    [HttpPost("{id:guid}/condition"), Authorize(Policy = Permissions.Assets.UpdateCondition)]
    public Task<AssetSummary> Condition(Guid id, AssetConditionInput input, CancellationToken t) =>
        assets.UpdateConditionAsync(id, input, t);
}
