using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Route("api/v1"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(1024 * 1024)]
public sealed class EquipmentInspectionsController(EquipmentInspectionService service) : ControllerBase
{
    [HttpPut("assets/{asset:guid}/inspection-schedules/{id:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Schedule(Guid asset, Guid id, InspectionScheduleWrite input, CancellationToken t) => service.SaveScheduleAsync(asset, id, input, t);
    [HttpGet("assets/{asset:guid}/inspection-schedules"), Authorize(Roles = Roles.Owner)]
    public Task<SetupPage> Schedules(Guid asset, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.SchedulesAsync(asset, page, pageSize, t);
    [HttpPost("equipment-inspection-schedules/{id:guid}/generate"), Authorize(Roles = Roles.Owner)]
    public async Task<object> Generate(Guid id, CancellationToken t) => new { created = await service.GenerateAsync(id, t) };
    [HttpGet("assets/{asset:guid}/inspections")]
    public Task<SetupPage> List(Guid asset, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.InspectionsAsync(asset, page, pageSize, t);
    [HttpGet("operational-tasks/{task:guid}/equipment-inspection")]
    public Task<SetupDocument?> ForTask(Guid task, CancellationToken t) => service.ForTaskAsync(task, t);
    [HttpPut("equipment-inspections/{id:guid}/answers"), Authorize(Roles = Roles.Staff)]
    public Task<SetupDocument> Answers(Guid id, InspectionBatch input, CancellationToken t) => service.SaveAnswersAsync(id, input, t);
    [HttpPost("equipment-inspections/{id:guid}/review"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Review(Guid id, InspectionReview input, CancellationToken t) => service.ReviewAsync(id, input, t);
    [HttpPost("equipment-inspections/{id:guid}/remediation"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Remediate(Guid id, InspectionRemediation input, CancellationToken t) => service.RemediateAsync(id, input, t);
}
