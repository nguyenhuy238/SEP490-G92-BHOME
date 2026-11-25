using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/staff-costs"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class StaffCostsController(StaffCostService service) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<StaffCostCandidate>> List([FromQuery] DateOnly period, CancellationToken token) =>
        service.CandidatesAsync(period, token);
    [HttpPost]
    public Task<IReadOnlyList<Guid>> Record(StaffCostInput input, CancellationToken token) =>
        service.RecordAsync(input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
