using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Ocr;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HouseholdsController(IHouseholdProfiles service) : ControllerBase
{
    [HttpGet("api/v1/capture/residents/{id:guid}/household"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<HouseholdView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPut("api/v1/capture/residents/{id:guid}/household"), Authorize(Roles = Roles.Staff), RequestSizeLimit(32768)]
    public Task<HouseholdView> Save(Guid id, HouseholdSaveInput input, CancellationToken t) =>
        service.SaveAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
    [HttpGet("api/v1/contracts/{id:guid}/household"), Authorize(Roles = Roles.Owner + "," + Roles.Staff + "," + Roles.Tenant)]
    public Task<HouseholdView> Contract(Guid id, CancellationToken t) => service.ContractAsync(id, t);
}
