using BHome.Application.StaffOperations;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.StaffOperations;

[ApiController, Route("api/v1/operational-tasks"), Authorize(Policy = Permissions.OperationalTasks.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(65536)]
public sealed class OperationalTasksController(OperationalTaskService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty
        ? key : throw OperationalTaskException.Invalid("idempotency_key_required");
    [HttpPost, Authorize(Policy = Permissions.OperationalTasks.Manage)]
    [ProducesResponseType(typeof(TaskView), StatusCodes.Status201Created)]
    public async Task<ActionResult<TaskView>> Create(TaskCreate input, CancellationToken t)
    { var result = await service.CreateAsync(input, Key(), t); return CreatedAtAction(nameof(Get), new { id = result.Id }, result); }
    [HttpGet]
    public Task<TaskPage<TaskView>> List([FromQuery] TaskQuery query, CancellationToken t) => service.ListAsync(query, t);
    [HttpGet("{id:guid}")]
    public Task<TaskView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.OperationalTasks.Manage)]
    public Task<TaskView> Update(Guid id, TaskUpdate input, CancellationToken t) => service.UpdateAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/assign"), Authorize(Policy = Permissions.OperationalTasks.Manage)]
    public Task<TaskView> Assign(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "assign", input, Key(), t);
    [HttpPost("{id:guid}/start"), Authorize(Policy = Permissions.OperationalTasks.Execute)]
    public Task<TaskView> Start(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "start", input, Key(), t);
    [HttpPost("{id:guid}/progress"), Authorize(Policy = Permissions.OperationalTasks.Execute)]
    public Task<TaskView> Progress(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "progress", input, Key(), t);
    [HttpPost("{id:guid}/blockers"), Authorize(Policy = Permissions.OperationalTasks.Execute)]
    public Task<TaskView> Blockers(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "blockers", input, Key(), t);
    [HttpPost("{id:guid}/coordinate"), Authorize(Policy = Permissions.OperationalTasks.Manage)]
    public Task<TaskView> Coordinate(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "coordinate", input, Key(), t);
    [HttpPost("{id:guid}/submit"), Authorize(Policy = Permissions.OperationalTasks.Execute)]
    public Task<TaskView> Submit(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "submit", input, Key(), t);
    [HttpPost("{id:guid}/verify"), Authorize(Policy = Permissions.OperationalTasks.Verify)]
    public Task<TaskView> Verify(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "verify", input, Key(), t);
    [HttpPost("{id:guid}/rework"), Authorize(Policy = Permissions.OperationalTasks.Verify)]
    public Task<TaskView> Rework(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "rework", input, Key(), t);
    [HttpPost("{id:guid}/cancel"), Authorize(Policy = Permissions.OperationalTasks.Manage)]
    public Task<TaskView> Cancel(Guid id, TaskAction input, CancellationToken t) => service.ActAsync(id, "cancel", input, Key(), t);
    [HttpGet("{id:guid}/history")]
    public Task<TaskPage<TaskHistoryView>> History(Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.HistoryAsync(id, page, pageSize, t);
    [HttpGet("{id:guid}/evidence")]
    public Task<IReadOnlyList<TaskEvidenceView>> Evidence(Guid id, CancellationToken t) => service.EvidenceAsync(id, t);
    [HttpPut("{id:guid}/evidence"), Authorize(Policy = Permissions.OperationalTasks.Execute), Consumes("image/png", "image/jpeg"), RequestSizeLimit(20 * 1024 * 1024)]
    public Task<TaskEvidenceView> Upload(Guid id, CancellationToken t) => service.UploadAsync(id, Key(), Request.Body, t);
    [HttpGet("{id:guid}/evidence/{evidenceId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid evidenceId, CancellationToken t)
    {
        var output = new MemoryStream();
        try
        {
            var type = await service.CopyEvidenceAsync(id, evidenceId, output, t); output.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff";
            return File(output, type, "task-evidence" + (type == "image/png" ? ".png" : ".jpg"));
        }
        catch { await output.DisposeAsync(); throw; }
    }
    [HttpGet("notifications"), Authorize(Policy = Permissions.Notifications.ReadOwn)]
    public Task<TaskPage<TaskNotificationView>> Notifications([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.NotificationsAsync(page, pageSize, t);
    [HttpPost("notifications/{id:guid}/read"), Authorize(Policy = Permissions.Notifications.ReadOwn)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Read(Guid id, CancellationToken t) { await service.MarkReadAsync(id, t); return NoContent(); }
}
