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

    [HttpGet("{roomId:guid}/handover-preparation")]
    public async Task<BHome.Application.Contracts.HandoverInventory> Handover(Guid locationId, Guid roomId, CancellationToken t)
    {
        var rooms = await service.GetAsync(locationId, t);
        if (!rooms.Rooms.Any(r => r.RoomId == roomId)) throw new PropertyException(404, "resource_not_found");
        return await service.PrepareAsync(roomId, t);
    }

    [HttpPost("{roomId:guid}/no-assets")]
    public async Task<BHome.Application.Contracts.HandoverInventory> NoAssets(Guid locationId, Guid roomId, RoomNoAssetsConfirmation input, CancellationToken t)
    {
        var rooms = await service.GetAsync(locationId, t);
        if (!rooms.Rooms.Any(r => r.RoomId == roomId)) throw new PropertyException(404, "resource_not_found");
        return await service.ConfirmNoAssetsAsync(roomId, input, t);
    }
}
