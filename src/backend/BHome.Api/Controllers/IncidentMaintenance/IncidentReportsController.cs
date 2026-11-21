using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

public sealed class IncidentSubmitForm
{
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    [StringLength(200)] public string? CommonArea { get; set; }
    public Guid? AssetId { get; set; }
    [Required] public IncidentSeverity? Severity { get; set; }
    [Required, StringLength(8000, MinimumLength = 10)] public string Description { get; set; } = "";
    [MaxLength(5)] public List<IFormFile> Images { get; set; } = [];
}

[ApiController, Route("api/v1/incidents"), Authorize(Policy = Permissions.Incidents.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(65536)]
public sealed class IncidentReportsController(IncidentService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty
        ? key : throw IncidentException.Invalid("idempotency_key_required");
    [HttpPost, Authorize(Policy = Permissions.Incidents.Report), Consumes("multipart/form-data")]
    [RequestSizeLimit(26_000_000), RequestFormLimits(MultipartBodyLengthLimit = 26_000_000)]
    [ProducesResponseType(typeof(IncidentCommandResult), StatusCodes.Status201Created)]
    public async Task<ActionResult<IncidentCommandResult>> Submit([FromForm] IncidentSubmitForm input, CancellationToken t)
    {
        var key = Key(); var images = new List<IncidentImage>();
        try
        {
            if (input.Images.Count > IncidentService.MaximumImages) throw IncidentException.Invalid("incident_evidence_limit");
            foreach (var file in input.Images)
            {
                if (file.Length > IncidentService.MaximumImageBytes) throw new IncidentException(413, "incident_image_too_large");
                if (file.ContentType is not ("image/png" or "image/jpeg")) throw new IncidentException(415, "unsupported_incident_image");
                using var memory = new MemoryStream(); await using var stream = file.OpenReadStream();
                await stream.CopyToAsync(memory, t); images.Add(new(memory.ToArray()));
            }
            var result = await service.SubmitAsync(new(input.LocationId, input.RoomId, input.CommonArea, input.AssetId,
                input.Severity ?? throw IncidentException.Invalid("severity_required"), input.Description), images, key, t);
            return CreatedAtAction(nameof(Get), new { id = result.IncidentId }, result);
        }
        finally { foreach (var image in images) CryptographicOperations.ZeroMemory(image.Content); }
    }
    [HttpGet]
    public Task<IncidentPage<IncidentView>> List([FromQuery] IncidentQuery query, CancellationToken t) => service.ListAsync(query, t);
    [HttpGet("reporting-rooms"), Authorize(Policy = Permissions.Incidents.Report)]
    public Task<IncidentPage<IncidentReportingRoom>> ReportingRooms([FromQuery] IncidentLookupQuery query, CancellationToken t) => service.ReportingRoomsAsync(query, t);
    [HttpGet("reporting-assets"), Authorize(Policy = Permissions.Incidents.Report)]
    public Task<IncidentPage<IncidentReportingAsset>> ReportingAssets([FromQuery] IncidentLookupQuery query, CancellationToken t) => service.ReportingAssetsAsync(query, t);
    [HttpGet("{id:guid}")]
    public Task<IncidentView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpGet("{id:guid}/history")]
    public Task<IncidentPage<IncidentActivityView>> History(Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.HistoryAsync(id, page, pageSize, t);
    [HttpPost("{id:guid}/review"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Review(Guid id, IncidentReview input, CancellationToken t) => service.ReviewAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/reject"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Reject(Guid id, IncidentDecision input, CancellationToken t) => service.DecideAsync(id, "reject", input, Key(), t);
    [HttpPost("{id:guid}/duplicate"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Duplicate(Guid id, IncidentDecision input, CancellationToken t) => service.DecideAsync(id, "duplicate", input, Key(), t);
    [HttpPost("{id:guid}/cancel")]
    public Task<IncidentCommandResult> Cancel(Guid id, IncidentDecision input, CancellationToken t) => service.DecideAsync(id, "cancel", input, Key(), t);
    [HttpPost("{id:guid}/resolve"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Resolve(Guid id, IncidentDecision input, CancellationToken t) => service.DecideAsync(id, "resolve", input, Key(), t);
    [HttpPost("{id:guid}/work-orders"), Authorize(Policy = Permissions.Incidents.Manage)]
    [ProducesResponseType(typeof(IncidentCommandResult), StatusCodes.Status201Created)]
    public async Task<ActionResult<IncidentCommandResult>> Assign(Guid id, WorkOrderAssign input, CancellationToken t)
    { var result = await service.AssignAsync(id, input, Key(), t); return Created($"/api/v1/work-orders/{result.WorkOrderId}", result); }
    [HttpPost("{id:guid}/direct-completion"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Direct(Guid id, DirectCompletion input, CancellationToken t) => service.DirectAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/acknowledge"), Authorize(Policy = Permissions.Incidents.Respond)]
    public Task<IncidentCommandResult> Acknowledge(Guid id, WorkOrderAction input, CancellationToken t) => service.AcknowledgeAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/emergency-actions")]
    public Task<IncidentCommandResult> EmergencyAction(Guid id, EmergencyEntry input, CancellationToken t) => service.EmergencyEntryAsync(id, input, Key(), t);
    [HttpGet("{id:guid}/emergency-actions"), Authorize(Policy = Permissions.WorkOrders.View)]
    public Task<IReadOnlyList<EmergencyActionView>> EmergencyActions(Guid id, CancellationToken t) => service.EmergencyActionsAsync(id, t);
    [HttpPost("{id:guid}/emergency-actions/{entryId:guid}/cost-decision"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> EmergencyCost(Guid id, Guid entryId, EmergencyCostDecision input, CancellationToken t) => service.EmergencyCostAsync(id, entryId, input, Key(), t);
    [HttpGet("{id:guid}/expenses"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IReadOnlyList<ExpenseView>> Expenses(Guid id, CancellationToken t) => service.ExpensesAsync(id, t);
    [HttpGet("{id:guid}/evidence")]
    public Task<IReadOnlyList<IncidentEvidenceView>> Evidence(Guid id, CancellationToken t) => service.EvidenceAsync(id, t);
    [HttpPut("{id:guid}/evidence"), Consumes("image/png", "image/jpeg"), RequestSizeLimit(IncidentService.MaximumImageBytes)]
    public Task<IncidentCommandResult> Upload(Guid id, [FromQuery] IncidentEvidenceKind kind, [FromQuery] Guid? workOrderId, CancellationToken t) =>
        service.UploadAsync(id, workOrderId, kind, Key(), Request.Body, t);
    [HttpGet("{id:guid}/evidence/{imageId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid imageId, CancellationToken t)
    {
        var output = new MemoryStream();
        try
        {
            var type = await service.CopyEvidenceAsync(id, imageId, output, t); output.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff";
            return File(output, type, "incident-evidence" + (type == "image/png" ? ".png" : ".jpg"));
        }
        catch { await output.DisposeAsync(); throw; }
    }
    [HttpGet("notifications")]
    public Task<IncidentPage<IncidentNotificationView>> Notifications([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.NotificationsAsync(page, pageSize, t);
    [HttpPost("notifications/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken t) { await service.MarkReadAsync(id, t); return NoContent(); }
}
