using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

[ApiController, Route("api/v1/work-orders"), Authorize(Policy = Permissions.WorkOrders.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(65536)]
public sealed class WorkOrdersController(IncidentService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty
        ? key : throw IncidentException.Invalid("idempotency_key_required");
    [HttpGet]
    public Task<IncidentPage<WorkOrderView>> List([FromQuery] IncidentQuery query, CancellationToken t) => service.WorkOrdersAsync(query, t);
    [HttpGet("{id:guid}")]
    public Task<WorkOrderView> Get(Guid id, CancellationToken t) => service.WorkOrderAsync(id, t);
    [HttpGet("maintenance-history")]
    public Task<IncidentPage<MaintenanceHistoryView>> Maintenance([FromQuery] IncidentQuery query, CancellationToken t) => service.MaintenanceAsync(query, t);
    [HttpPost("{id:guid}/reassign"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Reassign(Guid id, WorkOrderReassign input, CancellationToken t) => service.ReassignAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/proposal"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> Propose(Guid id, RepairProposal input, CancellationToken t) => service.ProposeAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/plan-decision"), Authorize(Policy = Permissions.WorkOrders.ApprovePlan)]
    public Task<IncidentCommandResult> Plan(Guid id, PlanDecision input, CancellationToken t) => service.PlanAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/start"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> Start(Guid id, WorkOrderAction input, CancellationToken t) => service.ActAsync(id, "start", input, Key(), t);
    [HttpPost("{id:guid}/progress"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> Progress(Guid id, WorkOrderAction input, CancellationToken t) => service.ActAsync(id, "progress", input, Key(), t);
    [HttpPost("{id:guid}/blocker"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> Blocker(Guid id, WorkOrderAction input, CancellationToken t) => service.ActAsync(id, "blocker", input, Key(), t);
    [HttpPost("{id:guid}/submit"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> Submit(Guid id, WorkOrderAction input, CancellationToken t) => service.ActAsync(id, "submit", input, Key(), t);
    [HttpPost("{id:guid}/verify"), Authorize(Policy = Permissions.WorkOrders.Verify)]
    public Task<IncidentCommandResult> Verify(Guid id, MaintenanceVerification input, CancellationToken t) => service.VerifyAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/rework"), Authorize(Policy = Permissions.WorkOrders.Verify)]
    public Task<IncidentCommandResult> Rework(Guid id, WorkOrderAction input, CancellationToken t) => service.ActAsync(id, "rework", input, Key(), t);
    [HttpPost("{id:guid}/cancel"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Cancel(Guid id, IncidentDecision input, CancellationToken t) => service.CancelWorkOrderAsync(id, input, Key(), t);
}
