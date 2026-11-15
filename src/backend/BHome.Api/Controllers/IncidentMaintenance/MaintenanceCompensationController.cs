using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IncidentMaintenance;

[ApiController, Route("api/v1/work-orders/{id:guid}/compensation"), Authorize(Policy = Permissions.Incidents.Manage)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class MaintenanceCompensationController(CompensationService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty
        ? key : throw IncidentException.Invalid("idempotency_key_required");
    [HttpGet]
    public async Task<IActionResult> Get(Guid id, CancellationToken t) => new JsonResult(await service.GetAsync(id, t));
    [HttpGet("history")]
    public Task<IReadOnlyList<CompensationView>> History(Guid id, CancellationToken t) => service.HistoryAsync(id, t);
    [HttpGet("contracts")]
    public Task<IReadOnlyList<CompensationContract>> Contracts(Guid id, CancellationToken t) => service.ContractsAsync(id, t);
    [HttpPost]
    public Task<CompensationView> Create(Guid id, CompensationInput input, CancellationToken t) => service.CreateAsync(id, input, Key(), t);
    [HttpPost("deduct")]
    public Task<CompensationView> Deduct(Guid id, CompensationDecision input, CancellationToken t) => service.DecideAsync(id, "deduct", input, Key(), t);
    [HttpPost("cancel")]
    public Task<CompensationView> Cancel(Guid id, CompensationDecision input, CancellationToken t) => service.DecideAsync(id, "cancel", input, Key(), t);
}
