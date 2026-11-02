using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.Notifications;
[ApiController, Route("api/v1/notifications"), Authorize(Policy = Permissions.Notifications.ReadOwn)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class NotificationsController(NotificationService service) : ControllerBase
{
    [HttpGet] public Task<PagedResult<NotificationView>> List([FromQuery] NotificationQuery query, CancellationToken t) => service.ListAsync(query, t);
    [HttpGet("unread-count")] public Task<NotificationCount> Unread(CancellationToken t) => service.UnreadAsync(t);
    [HttpPost("{id:guid}/read")] public async Task<IActionResult> Read(Guid id, CancellationToken t) { await service.ReadAsync(id, t); return NoContent(); }
    [HttpPost("read-all")] public async Task<IActionResult> ReadAll(CancellationToken t) { await service.ReadAsync(null, t); return NoContent(); }
    [HttpGet("{id:guid}/target")] public Task<NotificationTarget> Target(Guid id, CancellationToken t) => service.TargetAsync(id, t);
}
