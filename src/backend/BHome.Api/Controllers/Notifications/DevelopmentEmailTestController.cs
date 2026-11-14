using BHome.Application.Notifications;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers.Notifications;

[ApiController, Authorize(Roles = "Owner"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DevelopmentEmailTestController(IDevelopmentEmailTest service) : ControllerBase
{
    // No caller-controlled recipients, subject or content.
    [HttpPost("api/v1/notifications/email-test"), EnableRateLimiting("EmailTest"), RequestSizeLimit(0)]
    public Task<EmailTestResult> Send(CancellationToken t) => service.SendAsync(t);
}
