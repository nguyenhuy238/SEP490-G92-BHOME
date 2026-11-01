using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController,Route("api/v1/receiving-bank-accounts"),Authorize(Roles=Roles.Owner)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None),RequestSizeLimit(8192)]
public sealed class ReceivingAccountsController(TransferInstructionsService service):ControllerBase
{
    [HttpGet("{locationId:guid}")] public Task<ReceivingBankAccount?> Get(Guid locationId,CancellationToken t)=>service.GetAccountAsync(locationId,t);
    [HttpPut] public Task<ReceivingBankAccount> Save(ReceivingAccountInput input,CancellationToken t)=>service.SaveAccountAsync(input,t);
}
[ApiController,Route("api/v1/invoices/{id:guid}/transfer-instructions"),Authorize(Roles=Roles.Owner+","+Roles.Tenant)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class TransferInstructionsController(TransferInstructionsService service):ControllerBase
{
    [HttpGet] public Task<TransferInstructions> Get(Guid id,CancellationToken t)=>service.GetAsync(id,t);
}
