using BHome.Application.Notifications;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Notifications;

[ApiController, Authorize, RequestSizeLimit(65536), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class NotificationWorkspaceController(NotificationWorkspaceService service) : ControllerBase
{
    [HttpPost("api/v1/announcements/preview-recipients")]
    public Task<RecipientPreview> Preview(NotificationAudience input, CancellationToken t) => service.PreviewAsync(input, t);
    [HttpPost("api/v1/announcements")]
    public Task<AnnouncementView> Create(AnnouncementWrite input, CancellationToken t)
    {
        Guid? key = null;
        if (Request.Headers.TryGetValue("Idempotency-Key", out var header))
            key = Guid.TryParse(header, out var parsed) && parsed != Guid.Empty ? parsed : throw new NotificationException(400, "invalid_idempotency_key");
        return service.CreateAsync(input, t, key);
    }
    [HttpPost("api/v1/announcements/{id:guid}/send")]
    public Task<AnnouncementView> Send(Guid id, CancellationToken t) => service.SendAsync(id, t);
    [HttpGet("api/v1/announcements/sent")]
    public Task<IReadOnlyList<AnnouncementView>> Sent(CancellationToken t, int page = 1, int pageSize = 20) => service.SentAsync(page, pageSize, t);
    [HttpGet("api/v1/announcements/drafts")]
    public Task<IReadOnlyList<AnnouncementView>> Drafts(CancellationToken t, int page = 1, int pageSize = 20) => service.DraftsAsync(page, pageSize, t);
    [HttpPost("api/v1/notifications/devices")]
    public Task<PushDeviceView> Register(PushDeviceWrite input, CancellationToken t) => service.RegisterDeviceAsync(input, t);
    [HttpDelete("api/v1/notifications/devices/{id:guid}")]
    public async Task<IActionResult> Remove(Guid id, CancellationToken t) { await service.RemoveDeviceAsync(id, t); return NoContent(); }
    [HttpGet("api/v1/notifications/{id:guid}/deliveries")]
    public Task<IReadOnlyList<NotificationChannelStatus>> Deliveries(Guid id, CancellationToken t) => service.DeliveriesAsync(id, t);
    [HttpGet("api/v1/notifications/channel-status")]
    public Task<NotificationChannelOverview> ChannelOverview(CancellationToken t) => service.ChannelOverviewAsync(t);
    [HttpGet("api/v1/locations/{id:guid}/notification-policy")]
    public Task<NotificationReminderPolicy> Policy(Guid id, CancellationToken t) => service.PolicyAsync(id, t);
    [HttpPut("api/v1/locations/{id:guid}/notification-policy")]
    public Task<NotificationReminderPolicy> Policy(Guid id, NotificationReminderPolicy input, CancellationToken t) => service.SavePolicyAsync(id, input, t);
    [HttpGet("api/v1/tenant/rooms")]
    public Task<IReadOnlyList<TenantRoomView>> Rooms(CancellationToken t) => service.RoomsAsync(null, t);
    [HttpGet("api/v1/tenant/rooms/{id:guid}")]
    public async Task<TenantRoomView> Room(Guid id, CancellationToken t) => (await service.RoomsAsync(id, t)).SingleOrDefault() ?? throw new NotificationException(404, "room_not_found");
}
