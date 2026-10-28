using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Ocr;

[ApiController, Route("api/v1/capture"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class CaptureController(CaptureService service) : ControllerBase
{
    [HttpGet("chains")] public Task<IReadOnlyList<NamedResource>> Chains(CancellationToken t) => service.ChainsAsync(t);
    [HttpGet("locations")] public Task<IReadOnlyList<NamedResource>> Locations(CancellationToken t) => service.LocationsAsync(t);
    [HttpGet("locations/{id:guid}/rooms")] public Task<IReadOnlyList<NamedResource>> Rooms(Guid id, CancellationToken t) => service.RoomsAsync(id, t);
    [HttpGet("staff")] public Task<IReadOnlyList<NamedResource>> Staff(CancellationToken t) => service.StaffAsync(t);
    [HttpPost("staff"), Authorize(Roles = Roles.Owner), RequestSizeLimit(16384)] public Task<IdResult> Staff(StaffInput x, CancellationToken t) => service.CreateStaffAsync(x, t);
    [HttpPost("chains"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Chain(ChainInput x, CancellationToken t) => service.CreateChainAsync(x, t);
    [HttpPost("locations"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Location(LocationInput x, CancellationToken t) => service.CreateLocationAsync(x, t);
    [HttpPost("rooms"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Room(RoomInput x, CancellationToken t) => service.CreateRoomAsync(x, t);
    [HttpPost("assignments"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Assignment(AssignmentInput x, CancellationToken t) => service.AssignStaffAsync(x, t);
    [HttpGet("locations/{id:guid}/residents")] public Task<IReadOnlyList<ResidentSummary>> Residents(Guid id, CancellationToken t) => service.ResidentsAsync(id, t);
    [HttpPost("residents")] public Task<IdResult> Resident(ResidentInput x, CancellationToken t) => service.CreateResidentAsync(x, t);
    [HttpPost("residents/{id:guid}/confirm"), Authorize(Roles = Roles.Staff), RequestSizeLimit(16384)] public Task<IdentityConfirmationResult> Identity(Guid id, IdentityConfirmation x, CancellationToken t) => service.ConfirmIdentityAsync(id, x, t);
    [HttpGet("locations/{id:guid}/meters")] public Task<IReadOnlyList<NamedResource>> Meters(Guid id, CancellationToken t) => service.MetersAsync(id, t);
    [HttpPost("meters"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Meter(MeterInput x, CancellationToken t) => service.CreateMeterAsync(x, t);
    [HttpGet("meter-tasks")] public Task<IReadOnlyList<MeterTaskSummary>> Tasks(CancellationToken t) => service.TasksAsync(t);
    [HttpPost("meter-tasks"), Authorize(Roles = Roles.Owner)] public Task<IdResult> Task(MeterTaskInput x, CancellationToken t) => service.CreateTaskAsync(x, t);
    [HttpPut("meter-tasks/{id:guid}/evidence"), Authorize(Roles = Roles.Staff), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<IdResult> Evidence(Guid id, CancellationToken t) => service.UploadEvidenceAsync(id, Request.Body, t);
    [HttpPost("meter-tasks/{id:guid}/confirm"), Authorize(Roles = Roles.Staff), RequestSizeLimit(16384)] public Task<ConfirmedReading> ConfirmMeter(Guid id, MeterConfirmation x, CancellationToken t) => service.ConfirmMeterAsync(id, x, t);
    [HttpGet("readings/{id:guid}/evidence")]
    public async Task EvidenceFile(Guid id, CancellationToken t)
    {
        Response.ContentType = "application/octet-stream";
        Response.Headers.ContentDisposition = "attachment; filename=meter-evidence";
        await service.CopyEvidenceAsync(id, Response.Body, t);
    }
}
