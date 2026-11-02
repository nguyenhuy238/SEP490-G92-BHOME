using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.Billing;

[ApiController, Route("api/v1/billing-automation"), Authorize(Policy = Permissions.Locations.Manage)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class BillingAutomationController(BillingAutomationService service, BillingAutomationOperations operations) : ControllerBase
{
    [HttpGet("{locationId:guid}")]
    public Task<BillingAutomationPlan?> Get(Guid locationId, [FromQuery] DateOnly period, CancellationToken t) => service.GetAsync(locationId, period, t);
    [HttpGet("{locationId:guid}/history")]
    public Task<IReadOnlyList<BillingAutomationPlan>> History(Guid locationId, CancellationToken t) => service.HistoryAsync(locationId, t);
    [HttpPut]
    public Task<BillingAutomationPlan> Save(BillingAutomationWrite x, CancellationToken t) => service.SaveAsync(x, t);
    [HttpGet("executions")]
    public Task<IReadOnlyList<BillingAutomationExecution>> Executions([FromQuery] Guid locationId, [FromQuery] DateOnly period, CancellationToken t) => operations.ListAsync(locationId, period, t);
    [HttpPost("run-now")]
    public Task<BillingAutomationExecution?> Run(BillingRunInput x, CancellationToken t) => operations.RunAsync(x, t);
    [HttpGet("preview")]
    public Task<BillingAutomationPreview> Preview([FromQuery] Guid locationId, [FromQuery] DateOnly period, CancellationToken t) => operations.PreviewAsync(locationId, period, t);
    [HttpGet("attempts")]
    public Task<IReadOnlyList<BillingAutomationAttempt>> Attempts([FromQuery] Guid locationId, [FromQuery] DateOnly period, CancellationToken t) => operations.AttemptsAsync(locationId, period, t);
    [HttpGet("queue")]
    public Task<IReadOnlyList<BillingQueueView>> Queue([FromQuery] Guid locationId, [FromQuery] DateOnly period, CancellationToken t) => operations.QueueAsync(locationId, period, t);
    [HttpPost("meter-tasks/{taskId:guid}/assignment")]
    public async Task<IActionResult> Assign(Guid taskId, MeterAssignmentInput x, CancellationToken t) { await operations.AssignAsync(taskId, x, t); return NoContent(); }
    [HttpGet("representative")]
    public Task<BillingRepresentativeSelection?> Representative([FromQuery] Guid roomId, [FromQuery] DateOnly period, CancellationToken t) => operations.RepresentativeAsync(roomId, period, t);
    [HttpPut("representative")]
    public Task<BillingRepresentativeSelection> Select(BillingRepresentativeInput x, CancellationToken t) => operations.SelectAsync(x, t);
}
