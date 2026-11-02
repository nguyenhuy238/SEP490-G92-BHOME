using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.Notifications;
[ApiController, Route("api/v1/notifications/process-events"), Authorize(Policy = Permissions.Locations.Manage)]
public sealed class NotificationAutomationController(NotificationAutomationService service) : ControllerBase
{ [HttpPost] public Task<NotificationProcessResult> Publish(CancellationToken t) => service.PublishAsync(t); }
