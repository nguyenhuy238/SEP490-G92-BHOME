using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Route("api/v1/rooms"), Authorize(Policy = Permissions.Property.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class RoomsController(PropertyService service) : ControllerBase
{
    [HttpGet] public Task<PagedResult<RoomDto>> List([FromQuery] PropertyQuery q, CancellationToken t) => service.RoomsAsync(q, t);
    [HttpGet("{id:guid}")] public Task<RoomDto> Get(Guid id, CancellationToken t) => service.GetRoomAsync(id, t);
    [HttpGet("{id:guid}/prices")]
    public Task<ResolvedPrices> Prices(Guid id, [FromQuery] DateOnly effectiveOn, CancellationToken t) => service.ResolvePricesAsync(id, effectiveOn, t);
    [HttpGet("{id:guid}/readiness")]
    public Task<RoomReadinessDto> Readiness(Guid id, [FromQuery] RoomReadinessPurpose purpose,
        [FromQuery] Guid? contractId, [FromQuery] DateOnly? effectiveOn, CancellationToken t) =>
        service.RoomReadinessAsync(id, purpose, contractId, effectiveOn, t);
    [HttpGet("{id:guid}/history")]
    public Task<RoomHistoryPage> History(Guid id, [FromQuery] RoomHistoryQuery query, CancellationToken t) =>
        service.RoomHistoryAsync(id, query, t);
    [HttpPost, Authorize(Policy = Permissions.Property.Manage)]
    public async Task<ActionResult<RoomDto>> Create(RoomWrite input, CancellationToken t)
    {
        var x = await service.SaveRoomAsync(null, input, t); return CreatedAtAction(nameof(Get), new { id = x.Id }, x);
    }
    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<RoomDto> Update(Guid id, RoomWrite input, CancellationToken t) => service.SaveRoomAsync(id, input, t);
}

[ApiController, Route("api/v1/assets"), Authorize(Policy = Permissions.Property.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class AssetsController(PropertyService service) : ControllerBase
{
    [HttpGet] public Task<PagedResult<AssetDto>> List([FromQuery] PropertyQuery q, CancellationToken t) => service.AssetsAsync(q, t);
    [HttpGet("{id:guid}")] public Task<AssetDto> Get(Guid id, CancellationToken t) => service.GetAssetAsync(id, t);
    [HttpPost, Authorize(Policy = Permissions.Property.Manage)]
    public async Task<ActionResult<AssetDto>> Create(AssetWrite input, CancellationToken t)
    {
        var x = await service.SaveAssetAsync(null, input, t); return CreatedAtAction(nameof(Get), new { id = x.Id }, x);
    }
    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<AssetDto> Update(Guid id, AssetWrite input, CancellationToken t) => service.SaveAssetAsync(id, input, t);
    [HttpPatch("{id:guid}/condition"), Authorize(Policy = Permissions.Assets.UpdateCondition)]
    public Task<AssetDto> UpdateCondition(Guid id, AssetConditionUpdate input, CancellationToken t) => service.UpdateAssetConditionAsync(id, input, t);
}

[ApiController, Route("api/v1/billing-policies"), Authorize(Policy = Permissions.Property.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class BillingPoliciesController(PropertyService service) : ControllerBase
{
    [HttpGet] public Task<PagedResult<PolicyDto>> List([FromQuery] PropertyQuery q, CancellationToken t) => service.PoliciesAsync(q, t);
    [HttpGet("{id:guid}")] public Task<PolicyDto> Get(Guid id, CancellationToken t) => service.GetPolicyAsync(id, t);
    [HttpPost, Authorize(Policy = Permissions.Property.Manage)]
    public async Task<ActionResult<PolicyDto>> Create(PolicyWrite input, CancellationToken t)
    {
        var x = await service.CreatePolicyAsync(input, t); return CreatedAtAction(nameof(Get), new { id = x.Id }, x);
    }
    [HttpPost("{id:guid}/replacement"), Authorize(Policy = Permissions.Property.Manage)]
    public async Task<ActionResult<PolicyDto>> Replace(Guid id, PolicyReplacement input, CancellationToken t)
    {
        var x = await service.ReplacePolicyAsync(id, input, t); return CreatedAtAction(nameof(Get), new { id = x.Id }, x);
    }
    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<PolicyDto> Update(Guid id, PolicyUpdate input, CancellationToken t) => service.UpdateFuturePolicyAsync(id, input, t);
    [HttpPost("{id:guid}/end"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<PolicyDto> End(Guid id, PolicyEnd input, CancellationToken t) => service.EndPolicyAsync(id, input, t);
}
