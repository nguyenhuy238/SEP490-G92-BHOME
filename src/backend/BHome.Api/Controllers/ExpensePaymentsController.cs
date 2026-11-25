using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/expenses/{id:guid}/payments"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class ExpensePaymentsController(ExpensePaymentService service) : ControllerBase
{
    [HttpGet]
    public Task<ExpensePaymentView> Get(Guid id, CancellationToken token) => service.ReadAsync(id, token);

    [HttpPost]
    public Task<ExpensePaymentView> Record(Guid id, ExpensePaymentInput input, CancellationToken token) =>
        service.RecordAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);

    [HttpPost("due-date")]
    public Task<ExpensePaymentView> SetDueDate(Guid id, ExpenseDueDateInput input, CancellationToken token) =>
        service.SetDueDateAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
