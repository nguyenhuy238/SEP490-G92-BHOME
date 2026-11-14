using BHome.Infrastructure.Modules.Notifications;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/sms/esms/callback")]
public sealed class EsmsCallbackController(EsmsDeliveryCallback callback) : ControllerBase
{
    [HttpGet, AllowAnonymous]
    public async Task<IActionResult> Receive([FromQuery] EsmsDeliveryReport report, CancellationToken token)
    {
        Response.Headers.CacheControl = "no-store";
        if (report.SMSID is null || report.RequestId is null) return BadRequest();
        return await callback.ApplyAsync(report, HttpContext.Connection.RemoteIpAddress, token) ? Ok() : NotFound();
    }
}
