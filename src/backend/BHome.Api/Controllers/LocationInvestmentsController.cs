using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/location-investments"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LocationInvestmentsController(ExpenseService service) : ControllerBase
{
    [HttpGet]
    public Task<ExpensePage> List([FromQuery] ExpenseFilter filter, CancellationToken token) =>
        service.ListInvestmentsAsync(filter, token);

    [HttpPost]
    public Task<IReadOnlyList<ExpenseView>> Create(BulkInvestmentInput input, CancellationToken token) =>
        service.CreateInvestmentsAsync(input,
            Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
