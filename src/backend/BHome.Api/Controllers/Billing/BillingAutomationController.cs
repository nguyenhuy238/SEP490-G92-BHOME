using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.Billing;

[ApiController,Route("api/v1/billing-automation"),Authorize(Policy=Permissions.Locations.Manage)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class BillingAutomationController(BillingAutomationService service):ControllerBase
{
    [HttpGet("{locationId:guid}")]
    public Task<BillingAutomationPlan?> Get(Guid locationId,[FromQuery]DateOnly period,CancellationToken t)=>service.GetAsync(locationId,period,t);
    [HttpGet("{locationId:guid}/history")]
    public Task<IReadOnlyList<BillingAutomationPlan>> History(Guid locationId,CancellationToken t)=>service.HistoryAsync(locationId,t);
    [HttpPut]
    public Task<BillingAutomationPlan> Save(BillingAutomationWrite x,CancellationToken t)=>service.SaveAsync(x,t);
}
