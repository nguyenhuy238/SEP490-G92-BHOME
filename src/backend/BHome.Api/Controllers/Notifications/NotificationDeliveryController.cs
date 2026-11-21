using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.Notifications;
[ApiController, Route("api/v1/notifications/delivery-status"), Authorize(Policy = Permissions.Locations.Manage)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class NotificationDeliveryController(NotificationDeliveryAdministration service) : ControllerBase
{ [HttpGet] public Task<DeliveryOverview> List([FromQuery] DeliveryQuery q, CancellationToken t) => service.ListAsync(q, t); }
