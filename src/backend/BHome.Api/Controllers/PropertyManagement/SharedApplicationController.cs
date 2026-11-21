using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class SharedApplicationController(SharedConfigurationApplicationService service) : ControllerBase
{
    [HttpPost("api/v1/shared-configuration/{resource}/{id:guid}/apply-preview")]
    public Task<ConfigurationPlan> Preview(string resource, Guid id, SharedApply input, CancellationToken t) => service.PreviewAsync(resource, id, input, t);
    [HttpPost("api/v1/shared-configuration/{resource}/{id:guid}/apply")]
    public Task<SharedOperation> Apply(string resource, Guid id, SharedApply input, CancellationToken t) => service.ApplyAsync(resource, id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
    [HttpGet("api/v1/shared-configuration/{resource}/{id:guid}/applications")]
    public Task<SharedUsage> Applications(string resource, Guid id, CancellationToken t, [FromQuery] int page = 1, [FromQuery] int pageSize = 20) => service.ApplicationsAsync(resource, id, page, pageSize, t);
    [HttpGet("api/v1/locations/{locationId:guid}/room-defaults")]
    public Task<IReadOnlyList<SetupDocument>> Defaults(Guid locationId, CancellationToken t) => service.RoomDefaultsAsync(locationId, t);
}
