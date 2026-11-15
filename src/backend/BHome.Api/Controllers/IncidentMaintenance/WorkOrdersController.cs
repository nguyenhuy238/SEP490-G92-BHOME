using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
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
    [HttpGet("assignment"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<MaintenanceAssignment> Assignment([FromQuery] Guid locationId, CancellationToken t) => service.AssignmentAsync(locationId, t);
    [HttpPost, Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> Create(ProactiveMaintenance input, CancellationToken t) => service.CreateProactiveAsync(input, Key(), t);
    [HttpGet("fast-repair-policy")]
    public Task<FastRepairPolicyView> FastRepairPolicy(CancellationToken t) => service.GetFastRepairPolicyAsync(t);
    [HttpPost("fast-repair-policy"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> SaveFastRepairPolicy(FastRepairPolicyWrite input, CancellationToken t) => service.SaveFastRepairPolicyAsync(input, Key(), t);
    [HttpPost("{id:guid}/fast-repair-start"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> StartFastRepair(Guid id, FastRepairStart input, CancellationToken t) => service.StartFastRepairAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/fast-repair-fallback"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> FastRepairFallback(Guid id, WorkOrderAction input, CancellationToken t) => service.FastRepairFallbackAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/asset-proposal"), Authorize(Policy = Permissions.WorkOrders.Execute)]
    public Task<IncidentCommandResult> ProposeAsset(Guid id, AssetLinkProposal input, CancellationToken t) => service.ProposeAssetAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/asset-decision"), Authorize(Policy = Permissions.Incidents.Manage)]
    public Task<IncidentCommandResult> DecideAsset(Guid id, AssetLinkDecision input, CancellationToken t) => service.DecideAssetAsync(id, input, Key(), t);
    [HttpGet("{id:guid}/history")]
    public Task<IncidentPage<IncidentActivityView>> History(Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) =>
        service.WorkHistoryAsync(id, page, pageSize, t);
    [HttpGet("{id:guid}/evidence")]
    public Task<IReadOnlyList<IncidentEvidenceView>> Evidence(Guid id, CancellationToken t) => service.WorkEvidenceAsync(id, t);
    [HttpGet("{id:guid}/evidence/{imageId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid imageId, CancellationToken t)
    {
        var output = new MemoryStream();
        try { var type = await service.CopyWorkEvidenceAsync(id, imageId, output, t); output.Position = 0; return File(output, type); }
        catch { await output.DisposeAsync(); throw; }
    }
    [HttpPut("{id:guid}/evidence"), Authorize(Policy = Permissions.WorkOrders.Execute), RequestSizeLimit(5_100_000)]
    public Task<IncidentCommandResult> Upload(Guid id, [FromQuery] IncidentEvidenceKind kind, CancellationToken t)
    {
        return service.UploadWorkEvidenceAsync(id, kind, Key(), Request.Body, t);
    }
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
