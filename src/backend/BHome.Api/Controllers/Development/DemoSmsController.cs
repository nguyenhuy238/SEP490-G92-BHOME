using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/demo/sms"), Authorize(Policy = Permissions.Account.ViewOwn)]
public sealed class DemoSmsController(IDemoSmsInbox inbox) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<DemoSmsView>> List(Guid? recipient, string? template, CancellationToken token)
    { Response.Headers.CacheControl = "no-store"; Response.Headers.Pragma = "no-cache"; return inbox.ListAsync(recipient, template, token); }
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<DemoSmsView>> Get(Guid id, CancellationToken token)
    { Response.Headers.CacheControl = "no-store"; var message = (await inbox.ListAsync(null, null, token)).SingleOrDefault(m => m.Id == id); return message is null ? NotFound() : Ok(message); }
}
