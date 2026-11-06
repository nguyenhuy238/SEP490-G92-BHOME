using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/contracts/{id:guid}/deposit-deductions"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class DepositDeductionsController(DepositDeductionService service) : ControllerBase
{
    [HttpPost]
    public Task<DepositDeductionPlan> Approve(Guid id, DepositDeductionInput input, CancellationToken token) =>
        service.ApproveAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
