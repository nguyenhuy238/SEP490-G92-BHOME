using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/contracts/{id:guid}/initial-payment")]
[Authorize(Roles = Roles.Owner + "," + Roles.Staff + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class MainInitialPaymentsController(IMainInitialPayments service) : ControllerBase
{
    [HttpGet] public Task<MainInitialPaymentView> Get(Guid id, CancellationToken token) => service.GetAsync(id, false, token);
    [HttpPost("transfer-instructions")] public Task<MainInitialPaymentView> Issue(Guid id, CancellationToken token) => service.GetAsync(id, true, token);
}
