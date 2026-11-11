using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/payment-transactions/{id:guid}/external-payer"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(8192)]
public sealed class ExternalPaymentPayerController(ExternalPaymentPayerService service) : ControllerBase
{
    [HttpGet] public Task<ExternalPaymentPayerContext> Context(Guid id, CancellationToken token) => service.ContextAsync(id, token);
    [HttpPost] public Task<ExternalPaymentPayer> Confirm(Guid id, ExternalPaymentPayerInput input, CancellationToken token) =>
        service.ConfirmAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
