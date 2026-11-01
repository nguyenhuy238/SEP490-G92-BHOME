using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController,Route("api/v1/debts"),Authorize(Roles=Roles.Owner+","+Roles.Staff+","+Roles.Tenant)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class DebtsController(PaymentService service):ControllerBase
{
    [HttpGet] public Task<PagedResult<DebtInvoiceView>> List([FromQuery]PaymentQuery query,CancellationToken t)
    { query.OutstandingOnly=true;return service.DebtAsync(query,t); }
}
[ApiController,Route("api/v1/payment-invoices"),Authorize(Roles=Roles.Owner+","+Roles.Tenant)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class PaymentInvoicesController(PaymentService service):ControllerBase
{
    [HttpGet]public Task<PagedResult<DebtInvoiceView>> List([FromQuery]PaymentQuery query,CancellationToken t)=>service.DebtAsync(query,t);
}
[ApiController,Route("api/v1/payment-history"),Authorize(Roles=Roles.Owner+","+Roles.Tenant)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class PaymentHistoryController(PaymentService service):ControllerBase
{
    [HttpGet]public Task<PagedResult<PaymentHistoryEntry>> List([FromQuery]PaymentQuery query,CancellationToken t)=>service.PaymentHistoryAsync(query,t);
}
