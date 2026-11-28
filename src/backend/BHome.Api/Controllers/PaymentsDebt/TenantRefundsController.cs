using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Authorize(Roles = Roles.Tenant), Route("api/v1/tenant/refunds")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TenantRefundsController(RefundService service) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<TenantRefundView>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken token = default) =>
        service.TenantListAsync(page, pageSize, token);
}
