using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/integrations/sepay")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SePayController(SePayWebhookSecurity security, SePayService service, ISePayRepository repository,
    SePayOptions options, IHostEnvironment environment, ISePayOwnerConnections connections) : ControllerBase
{
    [HttpGet("testing-context"), Authorize(Roles = Roles.Owner)]
    public IActionResult TestingContext() => options.TestingAvailable(environment.EnvironmentName)
        ? Ok(new { mode = "Test" }) : NotFound();

    [HttpPost("webhook"), HttpPost("{mode}/webhook"), HttpPost("{mode}/owners/{ownerId:guid}/webhook"), AllowAnonymous, Consumes("application/json"), RequestSizeLimit(32768)]
    public async Task<IActionResult> Webhook(CancellationToken token, string? mode = null, Guid? ownerId = null)
    {
        if (ownerId is { } owner) await connections.ApplyOwnerAsync(owner, token);
        if (mode is not null) options.Select(mode);
        using var body = new MemoryStream();
        var buffer = new byte[4096];
        int count;
        while ((count = await Request.Body.ReadAsync(buffer, token)) > 0)
        {
            if (body.Length + count > 32768) return StatusCode(413);
            await body.WriteAsync(buffer.AsMemory(0, count), token);
        }
        var transaction = security.Authenticate(body.ToArray(), Request.Headers["X-SePay-Timestamp"].ToString(), Request.Headers["X-SePay-Signature"].ToString());
        await service.ReceiveAsync(transaction, token, options.WebhookSecret);
        return Ok(new { success = true });
    }
    [HttpGet("events"), Authorize(Roles = Roles.Owner)]
    public Task<PagedResult<SePayEventView>> Events([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken token = default) =>
        repository.EventsAsync(page, pageSize, token);
}
