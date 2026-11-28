using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/recurring-expenses"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class RecurringExpensesController(RecurringExpenseService service) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<RecurringExpenseView>> List([FromQuery] Guid locationId, CancellationToken token) =>
        service.ListAsync(locationId, token);
    [HttpPost]
    public Task<RecurringExpenseView> Create(RecurringExpenseWrite input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken token) =>
        service.CreateAsync(input, idempotencyKey ?? Guid.Empty, token);
    [HttpPut("{id:guid}")]
    public Task<RecurringExpenseView> Update(Guid id, RecurringExpenseWrite input, CancellationToken token) =>
        service.UpdateAsync(id, input, token);
}
