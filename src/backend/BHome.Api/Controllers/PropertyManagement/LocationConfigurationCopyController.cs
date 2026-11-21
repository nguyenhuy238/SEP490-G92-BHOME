using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Route("api/v1/location-configuration"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class LocationConfigurationCopyController(LocationConfigurationCopyService service) : ControllerBase
{
    [HttpPost("copy-preview")] public Task<ConfigurationCopyPlan> Preview(ConfigurationCopy input, CancellationToken t) => service.PreviewAsync(input, t);
    [HttpPost("copy")] public Task<SharedOperation> Copy(ConfigurationCopy input, CancellationToken t) => service.CopyAsync(input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
}
