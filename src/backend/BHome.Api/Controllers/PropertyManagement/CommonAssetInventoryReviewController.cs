using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(1048576)]
[Route("api/v1/locations/{locationId:guid}/common-asset-inventory-review")]
public sealed class CommonAssetInventoryReviewController(CommonAssetInventoryReviewService service) : ControllerBase
{
    [HttpGet]
    public Task<CommonAssetInventoryView> Get(Guid locationId, CancellationToken t) => service.GetAsync(locationId, t);

    [HttpPost("confirm")]
    public Task<CommonAssetInventoryView> Confirm(Guid locationId, CommonAssetInventoryConfirm input, CancellationToken t) =>
        service.ConfirmAsync(locationId, input, t);
}
