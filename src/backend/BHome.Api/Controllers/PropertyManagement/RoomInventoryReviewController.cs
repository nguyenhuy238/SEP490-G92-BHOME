using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(1048576)]
[Route("api/v1/locations/{locationId:guid}/room-inventory-review")]
public sealed class RoomInventoryReviewController(RoomInventoryReviewService service) : ControllerBase
{
    [HttpGet]
    public Task<RoomInventoryReviewView> Get(Guid locationId, CancellationToken t) => service.GetAsync(locationId, t);

    [HttpPost("confirm")]
    public Task<RoomInventoryReviewView> Confirm(Guid locationId, RoomInventoryReviewConfirm input, CancellationToken t) =>
        service.ConfirmAsync(locationId, input, t);
}
