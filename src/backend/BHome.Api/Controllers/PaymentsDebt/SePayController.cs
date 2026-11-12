using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/integrations/sepay")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SePayController(SePayWebhookSecurity security, SePayService service, ISePayRepository repository) : ControllerBase
{
    [HttpPost("webhook"), AllowAnonymous, Consumes("application/json"), RequestSizeLimit(32768)]
    public async Task<IActionResult> Webhook(CancellationToken token)
    {
        using var body = new MemoryStream();
        var buffer = new byte[4096];
        int count;
        while ((count = await Request.Body.ReadAsync(buffer, token)) > 0)
        {
            if (body.Length + count > 32768) return StatusCode(413);
            await body.WriteAsync(buffer.AsMemory(0, count), token);
        }
        var transaction = security.Authenticate(body.ToArray(), Request.Headers["X-SePay-Timestamp"].ToString(), Request.Headers["X-SePay-Signature"].ToString());
        await service.ReceiveAsync(transaction, token);
        return Ok(new { success = true });
    }
    [HttpGet("events"), Authorize(Roles = Roles.Owner)]
    public Task<PagedResult<SePayEventView>> Events([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken token = default) =>
        repository.EventsAsync(page, pageSize, token);
}
