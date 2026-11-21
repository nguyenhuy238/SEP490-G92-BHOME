using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner + "," + Roles.Staff), Route("api/v1")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class AssetLifecycleController(AssetLifecycleService service) : ControllerBase
{
    [HttpGet("locations/{location:guid}/asset-lifecycle-policies"), Authorize(Roles = Roles.Owner)]
    public Task<SetupPage> Policies(Guid location, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.PoliciesAsync(location, page, pageSize, t);
    [HttpPut("locations/{location:guid}/asset-lifecycle-policies/{id:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Policy(Guid location, Guid id, AssetLifecyclePolicyWrite input, CancellationToken t) => service.SavePolicyAsync(location, id, input, t);
    [HttpPost("asset-lifecycle-policies/{id:guid}/publish"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Publish(Guid id, TemplatePublish input, CancellationToken t) => service.PublishAsync(id, input.ExpectedVersion, t);
    [HttpGet("assets/{asset:guid}/equipment-units")]
    public Task<SetupPage> Units(Guid asset, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.UnitsAsync(asset, page, pageSize, t);
    [HttpGet("assets/{asset:guid}/lifecycle-summary")]
    public Task<AssetLifecycleSummary> Summary(Guid asset, CancellationToken t) => service.SummaryAsync(asset, t);
    [HttpPut("assets/{asset:guid}/equipment-units/{id:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Unit(Guid asset, Guid id, EquipmentUnitWrite input, CancellationToken t) => service.SaveUnitAsync(asset, id, input, t);
}
