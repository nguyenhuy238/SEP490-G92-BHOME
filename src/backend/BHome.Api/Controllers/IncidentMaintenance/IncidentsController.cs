using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

// UC-26 / UC-27 / UC-28. Thin HTTP layer: policy check, binding, then the application service.
[ApiController, Route("api/v1/incidents")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class IncidentsController(IncidentReportService reports, EmergencyResponseService emergency,
    IncidentReviewService review) : ControllerBase
{
    // ---- UC-26 ----

    [HttpGet("emergency-contacts"), Authorize(Policy = Permissions.Incidents.Report)]
    public IReadOnlyList<EmergencyContact> EmergencyContacts() => IncidentReportService.EmergencyContacts;

    [HttpPost, Authorize(Policy = Permissions.Incidents.Report)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public async Task<ActionResult<IncidentDetail>> Submit([FromForm] SubmitIncidentForm form, CancellationToken t)
    {
        var input = new SubmitIncidentInput(form.LocationId, form.RoomId, form.AssetId, form.Severity, form.Summary ?? "",
            form.Description ?? "");
        var created = await reports.SubmitAsync(input, Photos.From(form.Photos), t);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet, Authorize(Policy = Permissions.Incidents.View)]
    public Task<IReadOnlyList<IncidentSummary>> List([FromQuery] IncidentListQuery query, CancellationToken t) =>
        reports.ListAsync(query, t);

    [HttpGet("{id:guid}"), Authorize(Policy = Permissions.Incidents.View)]
    public Task<IncidentDetail> Get(Guid id, CancellationToken t) => reports.GetAsync(id, t);

    [HttpPost("{id:guid}/cancel"), Authorize(Policy = Permissions.Incidents.View)]
    public Task<IncidentDetail> Cancel(Guid id, OptionalReasonInput input, CancellationToken t) =>
        reports.CancelAsync(id, input, t);

    [HttpGet("{id:guid}/evidence/{fileId}"), Authorize(Policy = Permissions.Incidents.View)]
    public async Task Evidence(Guid id, string fileId, CancellationToken t)
    {
        var file = await reports.FindEvidenceAsync(id, fileId, t);
        Response.ContentType = file.ContentType;
        Response.Headers.XContentTypeOptions = "nosniff";
        await reports.CopyEvidenceAsync(file, Response.Body, t);
    }

    // ---- UC-27 ----

    [HttpPost("{id:guid}/acknowledge"), Authorize(Policy = Permissions.Incidents.RespondEmergency)]
    public Task<IncidentDetail> Acknowledge(Guid id, CancellationToken t) => emergency.AcknowledgeAsync(id, t);

    [HttpPost("{id:guid}/emergency-actions"), Authorize(Policy = Permissions.Incidents.RespondEmergency)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public Task<IncidentDetail> EmergencyAction(Guid id, [FromForm] NoteWithAmountForm form, CancellationToken t) =>
        emergency.AddImmediateActionAsync(id, new ImmediateActionInput(form.Note ?? "", form.Amount), Photos.From(form.Photos), t);

    // ---- UC-28 (Owner) ----

    [HttpPost("{id:guid}/classify"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<IncidentDetail> Classify(Guid id, ClassifyInput input, CancellationToken t) => review.ClassifyAsync(id, input, t);

    [HttpPost("{id:guid}/reject"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<IncidentDetail> Reject(Guid id, ReasonInput input, CancellationToken t) => review.RejectAsync(id, input, t);

    [HttpPost("{id:guid}/duplicate"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<IncidentDetail> Duplicate(Guid id, DuplicateInput input, CancellationToken t) =>
        review.MarkDuplicateAsync(id, input, t);

    [HttpPost("{id:guid}/resolve"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<IncidentDetail> Resolve(Guid id, ResolveInput input, CancellationToken t) =>
        review.ResolveWithoutActionAsync(id, input, t);

    [HttpPost("{id:guid}/handle-directly"), Authorize(Policy = Permissions.Incidents.Review)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public Task<IncidentDetail> HandleDirectly(Guid id, [FromForm] HandleDirectlyForm form, CancellationToken t) =>
        review.HandleDirectlyAsync(id, new HandleDirectlyInput(form.ResolutionNote ?? "", form.ActualCost),
            Photos.From(form.Photos), t);

    [HttpPost("{id:guid}/work-orders"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<WorkOrderSummary> CreateWorkOrder(Guid id, CreateWorkOrderInput input, CancellationToken t) =>
        review.CreateWorkOrderAsync(id, input, t);
}

public sealed class SubmitIncidentForm
{
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public IncidentSeverity Severity { get; set; }
    public string? Summary { get; set; }
    public string? Description { get; set; }
    public List<IFormFile>? Photos { get; set; }
}

public sealed class NoteWithAmountForm
{
    public string? Note { get; set; }
    public decimal? Amount { get; set; }
    public List<IFormFile>? Photos { get; set; }
}

public sealed class HandleDirectlyForm
{
    public string? ResolutionNote { get; set; }
    public decimal ActualCost { get; set; }
    public List<IFormFile>? Photos { get; set; }
}
