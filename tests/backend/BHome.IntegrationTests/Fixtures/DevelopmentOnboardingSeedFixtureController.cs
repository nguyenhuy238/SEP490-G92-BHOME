using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Development;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.IntegrationTests.Fixtures;

// Owner-only demo endpoint; all persistence, scope, and transaction checks
// live in DevelopmentOnboardingSeedService, not in the API controller.
[ApiController, Route("test-probe/onboarding-seed"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[EnableRateLimiting("Auth")]
public sealed class DevelopmentOnboardingSeedFixtureController(DevelopmentOnboardingSeedService seed) : ControllerBase
{
    public static bool Allowed(string environmentName, bool enabled, string? connectionString) =>
        DevelopmentOnboardingSeedService.Allowed(environmentName, enabled, connectionString);

    [HttpPost]
    public Task<DevelopmentOnboardingSeedResult> Create(DevelopmentOnboardingSeedInput input, CancellationToken t) =>
        seed.Create(input, Request.Headers["Idempotency-Key"].ToString(), t);
}
