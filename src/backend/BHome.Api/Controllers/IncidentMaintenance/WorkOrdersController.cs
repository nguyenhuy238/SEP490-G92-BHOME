using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

// UC-29 (assigned Staff) and UC-30 (Owner verification). The Work Order is created from an incident
// (POST /api/v1/incidents/{id}/work-orders).
[ApiController, Route("api/v1/work-orders")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class WorkOrdersController(WorkOrderService workOrders) : ControllerBase
{
    [HttpGet, Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<IReadOnlyList<WorkOrderSummary>> List([FromQuery] WorkOrderListQuery query, CancellationToken t) =>
        workOrders.ListAsync(query, t);

    [HttpGet("{id:guid}"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<WorkOrderDetail> Get(Guid id, CancellationToken t) => workOrders.GetAsync(id, t);

    // ---- Staff ----

    [HttpPost("{id:guid}/proposal"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public Task<WorkOrderDetail> Proposal(Guid id, [FromForm] ProposalForm form, CancellationToken t) =>
        workOrders.SubmitProposalAsync(id,
            new ProposalInput(form.InspectionResult ?? "", form.ProposedPlan ?? "", form.EstimatedDuration ?? "", form.EstimatedCost),
            Photos.From(form.Photos), t);

    [HttpPost("{id:guid}/start"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<WorkOrderDetail> Start(Guid id, CancellationToken t) => workOrders.StartAsync(id, t);

    [HttpPost("{id:guid}/progress"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public Task<WorkOrderDetail> Progress(Guid id, [FromForm] NoteForm form, CancellationToken t) =>
        workOrders.AddProgressAsync(id, new NoteInput(form.Note ?? ""), Photos.From(form.Photos), t);

    [HttpPost("{id:guid}/blockers"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<WorkOrderDetail> Blocker(Guid id, NoteInput input, CancellationToken t) =>
        workOrders.ReportBlockerAsync(id, input, t);

    [HttpPost("{id:guid}/submit"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    [Consumes("multipart/form-data"), RequestSizeLimit(Photos.MaxBody), RequestFormLimits(MultipartBodyLengthLimit = Photos.MaxBody)]
    public Task<WorkOrderDetail> Submit(Guid id, [FromForm] SubmitResultForm form, CancellationToken t) =>
        workOrders.SubmitForVerificationAsync(id, new SubmitResultInput(form.ResultSummary ?? ""), Photos.From(form.Photos), t);

    // ---- Owner ----

    [HttpPost("{id:guid}/approve-plan"), Authorize(Policy = Permissions.WorkOrders.ApprovePlan)]
    public Task<WorkOrderDetail> ApprovePlan(Guid id, CancellationToken t) => workOrders.ApprovePlanAsync(id, t);

    [HttpPost("{id:guid}/reject-plan"), Authorize(Policy = Permissions.WorkOrders.ApprovePlan)]
    public Task<WorkOrderDetail> RejectPlan(Guid id, ReasonInput input, CancellationToken t) =>
        workOrders.RejectPlanAsync(id, input, t);

    [HttpPost("{id:guid}/verify"), Authorize(Policy = Permissions.WorkOrders.Verify)]
    public Task<WorkOrderDetail> Verify(Guid id, VerifyInput input, CancellationToken t) => workOrders.VerifyAsync(id, input, t);

    [HttpPost("{id:guid}/request-rework"), Authorize(Policy = Permissions.WorkOrders.Verify)]
    public Task<WorkOrderDetail> RequestRework(Guid id, ReasonInput input, CancellationToken t) =>
        workOrders.RequestReworkAsync(id, input, t);

    [HttpPost("{id:guid}/reassign"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<WorkOrderDetail> Reassign(Guid id, ReassignInput input, CancellationToken t) =>
        workOrders.ReassignAsync(id, input, t);

    [HttpPost("{id:guid}/cancel"), Authorize(Policy = Permissions.Incidents.Review)]
    public Task<WorkOrderDetail> Cancel(Guid id, ReasonInput input, CancellationToken t) => workOrders.CancelAsync(id, input, t);
}

// Screen 6.4.1 Maintenance History (Owner).
[ApiController, Route("api/v1/maintenance-history")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class MaintenanceHistoryController(WorkOrderService workOrders) : ControllerBase
{
    [HttpGet, Authorize(Policy = Permissions.Incidents.Review)]
    public Task<IReadOnlyList<MaintenanceHistoryItem>> List([FromQuery] MaintenanceHistoryQuery query, CancellationToken t) =>
        workOrders.HistoryAsync(query, t);
}

public sealed class ProposalForm
{
    public string? InspectionResult { get; set; }
    public string? ProposedPlan { get; set; }
    public string? EstimatedDuration { get; set; }
    public decimal? EstimatedCost { get; set; }
    public List<IFormFile>? Photos { get; set; }
}

public sealed class NoteForm
{
    public string? Note { get; set; }
    public List<IFormFile>? Photos { get; set; }
}

public sealed class SubmitResultForm
{
    public string? ResultSummary { get; set; }
    public List<IFormFile>? Photos { get; set; }
}
