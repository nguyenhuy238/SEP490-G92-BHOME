using BHome.Application.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/tenant/meter-readings"), Authorize(Roles = Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TenantMeterReadingsController(TenantMeterReadingService service) : ControllerBase
{
    [HttpGet]
    public Task<TenantMeterReadingPage> List(CancellationToken t, [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] Guid? roomId = null, [FromQuery] DateOnly? billingPeriod = null) => service.ListAsync(page, pageSize, roomId, billingPeriod, t);
    [HttpGet("{id:guid}/evidence")]
    public async Task<IActionResult> Evidence(Guid id, CancellationToken t)
    {
        var output = new MemoryStream(); var type = await service.CopyEvidenceAsync(id, output, t);
        output.Position = 0; return File(output, type, "bang-chung-chi-so");
    }
}
