using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/demo-clock"), Authorize(Roles = Roles.Owner + "," + Roles.Staff + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DemoClockController(TimeProvider clock, IHostEnvironment environment, IConfiguration configuration,
    ICurrentUser currentUser) : ControllerBase
{
    public sealed record ChangeInput(DateOnly? BusinessDate, long? ExpectedVersion, DateTimeOffset? BusinessDateTime = null);

    private bool Available => (environment.IsDevelopment() || environment.IsStaging() || environment.IsProduction()) && clock is DemoBusinessClock;

    private bool CanChange => currentUser.IsInRole(Roles.Owner) && currentUser.UserId is { } actor &&
        (environment.IsDevelopment() || string.IsNullOrWhiteSpace(configuration["DemoClock:OwnerUserId"]) ||
         Guid.TryParse(configuration["DemoClock:OwnerUserId"], out var ownerId) && actor == ownerId);

    [HttpGet]
    public ActionResult<DemoClockState> Read() => Available && clock is DemoBusinessClock demo
        ? Ok(demo.Read() with { CanChange = CanChange }) : NotFound();

    [HttpPut, Authorize(Roles = Roles.Owner)]
    public ActionResult<DemoClockState> Change(ChangeInput input)
    {
        if (!Available || clock is not DemoBusinessClock demo) return NotFound();
        if (!CanChange) return Forbid();
        if (input.ExpectedVersion is null or < 0 || input.BusinessDate is { } date && (date.Year < 2000 || date.Year > 2100)) return BadRequest();
        if (input.BusinessDateTime is { } instant &&
            (instant.Offset != TimeSpan.FromHours(7) || instant.Year is < 2000 or > 2100 || input.BusinessDate is not null)) return BadRequest();
        var state = input.BusinessDateTime is { } target
            ? demo.ChangeTime(target, input.ExpectedVersion.Value)
            : demo.Change(input.BusinessDate, input.ExpectedVersion.Value);
        return state is null ? Conflict() : Ok(state with { CanChange = true });
    }
}
