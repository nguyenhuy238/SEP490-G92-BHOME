using BHome.Application.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers.Operations;

[ApiController, Route("api/v1/account/profile"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class AccountProfileController(OperationsService service) : ControllerBase
{
    [HttpGet] public Task<ProfileView> Get(CancellationToken t) => service.ProfileAsync(t);
    [HttpPut, EnableRateLimiting("Auth")] public Task<ProfileView> Update(ProfileUpdate input, CancellationToken t) => service.UpdateProfileAsync(input, t);
}

[ApiController, Route("api/v1/staff"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class StaffAdministrationController(OperationsService service) : ControllerBase
{
    [HttpGet] public Task<OperationsPage<StaffView>> List([FromQuery] StaffQuery input, CancellationToken t) => service.StaffAsync(input, t);
    [HttpGet("{id:guid}")] public Task<StaffView> Get(Guid id, CancellationToken t) => service.StaffAsync(id, t);
    [HttpPost]
    public async Task<ActionResult<StaffView>> Create(StaffCreate input, CancellationToken t)
    {
        var result = await service.CreateStaffAsync(input, t);
        return CreatedAtAction(nameof(Get), new { id = result.UserId }, result);
    }
    [HttpPut("{id:guid}")] public Task<StaffView> Update(Guid id, StaffUpdate input, CancellationToken t) => service.UpdateStaffAsync(id, input, t);
}

[ApiController, Route("api/v1/residence-tasks"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ResidenceTasksController(OperationsService service) : ControllerBase
{
    [HttpGet] public Task<OperationsPage<ResidenceTaskView>> List([FromQuery] ResidenceQuery input, CancellationToken t) => service.ResidenceAsync(input, t);
    [HttpGet("{contractId:guid}/{residentId:guid}")] public Task<ResidenceTaskView> Get(Guid contractId, Guid residentId, CancellationToken t) => service.ResidenceAsync(contractId, residentId, t);
    [HttpPut("{contractId:guid}/{residentId:guid}")] public Task<ResidenceTaskView> Update(Guid contractId, Guid residentId, ResidenceUpdate input, CancellationToken t) => service.UpdateResidenceAsync(contractId, residentId, input, t);
    [HttpPost("{contractId:guid}/{residentId:guid}/owner-confirmation")] public Task<ResidenceTaskView> Confirm(Guid contractId, Guid residentId, ResidenceOwnerConfirmation input, CancellationToken t) => service.ConfirmResidenceAsync(contractId, residentId, input, t);
    [HttpPut("{contractId:guid}/{residentId:guid}/evidence"), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<ResidenceTaskView> Upload(Guid contractId, Guid residentId, CancellationToken t) => service.UploadResidenceEvidenceAsync(contractId, residentId, Request.Body, t);
    [HttpGet("{contractId:guid}/{residentId:guid}/evidence")]
    public async Task<IActionResult> Download(Guid contractId, Guid residentId, CancellationToken t)
    {
        var output = new MemoryStream();
        try
        {
            var type = await service.CopyResidenceEvidenceAsync(contractId, residentId, output, t); output.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff";
            return File(output, type, "residence-evidence" + (type == "image/png" ? ".png" : ".jpg"));
        }
        catch { await output.DisposeAsync(); throw; }
    }
}

[ApiController, Route("api/v1/occupancy"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OccupancyController(OperationsService service) : ControllerBase
{
    [HttpGet] public Task<OperationsPage<RoomOccupancyView>> List([FromQuery] OccupancyQuery input, CancellationToken t) => service.OccupancyAsync(input, t);
}

[ApiController, Route("api/v1/rooms"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class RoomOccupancyController(OperationsService service) : ControllerBase
{
    [HttpGet("{id:guid}/occupancy-history")] public Task<RoomOccupancyHistory> History(Guid id, CancellationToken t) => service.OccupancyHistoryAsync(id, t);
}

[ApiController, Route("api/v1/public-content"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicContentAdministrationController(OperationsService service) : ControllerBase
{
    [HttpGet("locations/{id:guid}/photos/{index:int}")]
    public Task<IActionResult> LocationPhotoPreview(Guid id, int index, CancellationToken t) => PhotoPreview("location", id, index, t);
    [HttpGet("rooms/{id:guid}/photos/{index:int}")]
    public Task<IActionResult> RoomPhotoPreview(Guid id, int index, CancellationToken t) => PhotoPreview("room", id, index, t);
    private async Task<IActionResult> PhotoPreview(string target, Guid id, int index, CancellationToken t)
    {
        var output = new MemoryStream();
        try
        {
            var type = await service.CopyManagedPublicPhotoAsync(target, id, index, output, t); output.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff"; return File(output, type);
        }
        catch { await output.DisposeAsync(); throw; }
    }
    [HttpGet("locations/{id:guid}")] public Task<LocationPublicContent> Location(Guid id, CancellationToken t) => service.LocationContentAsync(id, t);
    [HttpPut("locations/{id:guid}")] public Task<LocationPublicContent> UpdateLocation(Guid id, LocationPublicContentWrite input, CancellationToken t) => service.UpdateLocationContentAsync(id, input, t);
    [HttpPost("locations/{id:guid}/publish")] public Task<LocationPublicContent> PublishLocation(Guid id, CancellationToken t) => service.PublishLocationAsync(id, true, t);
    [HttpPost("locations/{id:guid}/unpublish")] public Task<LocationPublicContent> UnpublishLocation(Guid id, CancellationToken t) => service.PublishLocationAsync(id, false, t);
    [HttpPut("locations/{id:guid}/photos"), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<LocationPublicContent> LocationPhoto(Guid id, CancellationToken t) => service.UploadLocationPhotoAsync(id, Request.Body, t);
    [HttpDelete("locations/{id:guid}/photos/{index:int}")]
    public async Task<IActionResult> RemoveLocationPhoto(Guid id, int index, CancellationToken t)
    { await service.RemovePublicPhotoAsync("location", id, index, t); return NoContent(); }

    [HttpGet("rooms/{id:guid}")] public Task<RoomPublicContent> Room(Guid id, CancellationToken t) => service.RoomContentAsync(id, t);
    [HttpPut("rooms/{id:guid}")] public Task<RoomPublicContent> UpdateRoom(Guid id, RoomPublicContentWrite input, CancellationToken t) => service.UpdateRoomContentAsync(id, input, t);
    [HttpPost("rooms/{id:guid}/publish")] public Task<RoomPublicContent> PublishRoom(Guid id, CancellationToken t) => service.PublishRoomAsync(id, true, t);
    [HttpPost("rooms/{id:guid}/unpublish")] public Task<RoomPublicContent> UnpublishRoom(Guid id, CancellationToken t) => service.PublishRoomAsync(id, false, t);
    [HttpPut("rooms/{id:guid}/photos"), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<RoomPublicContent> RoomPhoto(Guid id, CancellationToken t) => service.UploadRoomPhotoAsync(id, Request.Body, t);
    [HttpDelete("rooms/{id:guid}/photos/{index:int}")]
    public async Task<IActionResult> RemoveRoomPhoto(Guid id, int index, CancellationToken t)
    { await service.RemovePublicPhotoAsync("room", id, index, t); return NoContent(); }
}

[ApiController, Route("api/v1/public"), AllowAnonymous]
[ResponseCache(Duration = 60, Location = ResponseCacheLocation.Any)]
public sealed class PublicInformationController(OperationsService service) : ControllerBase
{
    [HttpGet("locations")] public Task<IReadOnlyList<LocationPublicContent>> Locations(CancellationToken t) => service.PublishedLocationsAsync(t);
    [HttpGet("locations/{id:guid}")] public Task<LocationPublicContent> Location(Guid id, CancellationToken t) => service.PublishedLocationAsync(id, t);
    [HttpGet("locations/{id:guid}/rooms")] public Task<IReadOnlyList<RoomPublicContent>> Rooms(Guid id, CancellationToken t) => service.PublishedRoomsAsync(id, t);
    [HttpGet("rooms/{id:guid}")] public Task<RoomPublicContent> Room(Guid id, CancellationToken t) => service.PublishedRoomAsync(id, t);
    [HttpGet("locations/{id:guid}/photos/{index:int}")] public Task<IActionResult> LocationPhoto(Guid id, int index, CancellationToken t) => Photo("location", id, index, t);
    [HttpGet("rooms/{id:guid}/photos/{index:int}")] public Task<IActionResult> RoomPhoto(Guid id, int index, CancellationToken t) => Photo("room", id, index, t);

    private async Task<IActionResult> Photo(string target, Guid id, int index, CancellationToken t)
    {
        var output = new MemoryStream();
        try
        {
            var type = await service.CopyPublicPhotoAsync(target, id, index, output, t); output.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff"; return File(output, type);
        }
        catch { await output.DisposeAsync(); throw; }
    }
}

[ApiController, Route("api/v1/operational-task-templates"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class OperationalTaskTemplatesController(OperationsService service) : ControllerBase
{
    [HttpGet] public Task<IReadOnlyList<RecurringTaskTemplateView>> List([FromQuery] Guid locationId, CancellationToken t) => service.TemplatesAsync(locationId, t);
    [HttpPost]
    public async Task<ActionResult<RecurringTaskTemplateView>> Create(RecurringTaskTemplateWrite input, CancellationToken t)
    {
        var result = await service.SaveTemplateAsync(null, input, t);
        return Created($"/api/v1/operational-task-templates/{result.Id}", result);
    }
    [HttpPut("{id:guid}")] public Task<RecurringTaskTemplateView> Update(Guid id, RecurringTaskTemplateWrite input, CancellationToken t) => service.SaveTemplateAsync(id, input, t);
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] Guid locationId, [FromQuery] int version, CancellationToken t)
    { await service.RemoveTemplateAsync(locationId, id, version, t); return NoContent(); }
}
