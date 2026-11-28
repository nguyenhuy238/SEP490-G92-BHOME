using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/finance"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class TaxTrackingController(TaxTrackingService service) : ControllerBase
{
    [HttpGet("business-profiles")] public Task<SetupPage> Profiles([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.ProfilesAsync(page, pageSize, t);
    [HttpPut("business-profiles/{id:guid}")] public Task<SetupDocument> Profile(Guid id, LegalBusinessProfileWrite input, CancellationToken t) => service.SaveProfileAsync(id, input, t);
    [HttpGet("business-profiles/{id:guid}/versions")] public Task<IReadOnlyList<SetupDocument>> ProfileHistory(Guid id, CancellationToken t) => service.HistoryAsync(id, "LegalBusinessProfile", t);
    [HttpGet("tax-obligations")] public Task<SetupPage> Obligations([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.ObligationsAsync(page, pageSize, t);
    [HttpPut("tax-obligations/{id:guid}")] public Task<SetupDocument> Obligation(Guid id, TaxObligationWrite input, CancellationToken t) => service.SaveObligationAsync(id, input, t);
    [HttpGet("tax-obligations/{id:guid}/versions")] public Task<IReadOnlyList<SetupDocument>> History(Guid id, CancellationToken t) => service.HistoryAsync(id, "TaxObligation", t);
}
