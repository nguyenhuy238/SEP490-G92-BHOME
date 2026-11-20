using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Development;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers;

// Development-only endpoint; all persistence, scope, and transaction checks
// live in DevelopmentOnboardingSeedService, not in the API controller.
[ApiController, Route("api/v1/development/onboarding-seed"), Authorize(Roles = Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[EnableRateLimiting("Auth")]
public sealed class DevelopmentOnboardingSeedController(DevelopmentOnboardingSeedService seed) : ControllerBase
{
    public static bool Allowed(string environmentName, bool enabled, string? connectionString) =>
        DevelopmentOnboardingSeedService.Allowed(environmentName, enabled, connectionString);

    [HttpPost]
    public Task<DevelopmentOnboardingSeedResult> Create(DevelopmentOnboardingSeedInput input, CancellationToken t) =>
        seed.Create(input, Request.Headers["Idempotency-Key"].ToString(), t);
}
