using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/receiving-bank-accounts"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(8192)]
public sealed class ReceivingAccountsController(TransferInstructionsService service) : ControllerBase
{
    [HttpGet("owner")] public async Task<IActionResult> Owner(CancellationToken t) => new JsonResult(await service.GetOwnerAccountAsync(t));
    [HttpGet("owner/mode")] public Task<PaymentModeView> Mode(CancellationToken t) => service.GetPaymentModeAsync(t);
    [HttpPut("owner/mode")] public Task<PaymentModeView> Mode(PaymentModeInput input, CancellationToken t) => service.SetPaymentModeAsync(input, t);
    [HttpGet("owner/{mode}")] public async Task<IActionResult> ModeAccount(string mode, CancellationToken t) => new JsonResult(await service.GetOwnerAccountForModeAsync(mode, t));
    [HttpPut("owner")] public Task<ReceivingBankAccount> SaveOwner(OwnerReceivingAccountInput input, CancellationToken t) => service.SaveOwnerAccountAsync(input, t);
    [HttpGet("{locationId:guid}")] public Task<ReceivingBankAccount?> Get(Guid locationId, CancellationToken t) => service.GetAccountAsync(locationId, t);
    [HttpPut] public Task<ReceivingBankAccount> Save(ReceivingAccountInput input, CancellationToken t) => service.SaveAccountAsync(input, t);
}

[ApiController, Route("api/v1/receiving-bank-accounts/owner/sepay"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class OwnerSePayConnectionsController(BHome.Application.PaymentsDebt.SePay.ISePayOwnerConnections connections,
    BHome.Application.IdentityAccess.ICurrentUser actor) : ControllerBase
{
    private Guid Owner => actor.UserId ?? throw new PaymentException(401, "authentication_required");
    [HttpGet("{mode}")]
    public Task<BHome.Application.PaymentsDebt.SePay.SePayConnectionView> Get(string mode, CancellationToken token) => connections.GetAsync(Owner, mode, token);
    [HttpPut("{mode}")]
    public Task<BHome.Application.PaymentsDebt.SePay.SePayConnectionView> Save(string mode, BHome.Application.PaymentsDebt.SePay.SePayConnectionInput input, CancellationToken token) => connections.SaveAsync(Owner, mode, input, token);
    [HttpPost("{mode}/check")]
    public Task<BHome.Application.PaymentsDebt.SePay.SePayConnectionCheck> Check(string mode, CancellationToken token) => connections.CheckAsync(Owner, mode, token);
}
[ApiController, Route("api/v1/invoices/{id:guid}/transfer-instructions"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TransferInstructionsController(TransferInstructionsService service) : ControllerBase
{
    [HttpGet] public Task<TransferInstructions> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
}
