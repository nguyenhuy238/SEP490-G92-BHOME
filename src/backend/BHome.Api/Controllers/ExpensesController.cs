using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/expenses"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class ExpensesController(ExpenseService service) : ControllerBase
{
    [HttpGet] public Task<ExpensePage> List([FromQuery] ExpenseFilter filter, CancellationToken token) => service.ListAsync(filter, token);
    [HttpGet("{id:guid}")] public Task<ExpenseView> Get(Guid id, CancellationToken token) => service.GetAsync(id, token);
    [HttpPost] public Task<ExpenseView> Create(ExpenseInput input, CancellationToken token) => service.CreateAsync(input,
        Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
    [HttpPut("{id:guid}")] public Task<ExpenseView> Update(Guid id, ExpenseUpdate input, CancellationToken token) => service.UpdateAsync(id, input, token);
}
