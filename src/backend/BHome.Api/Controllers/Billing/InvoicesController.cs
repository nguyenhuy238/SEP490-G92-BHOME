using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Billing;

[ApiController, Route("api/v1/invoices"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(16384)]
public sealed class InvoicesController(InvoiceService service) : ControllerBase
{
    [HttpGet] public Task<PagedResult<InvoiceView>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] Guid? roomId = null, CancellationToken t = default) => service.ListAsync(page, pageSize, roomId, t);
    [HttpGet("{id:guid}")] public Task<InvoiceView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPost("drafts"), Authorize(Roles = Roles.Owner)] public Task<InvoiceView> Draft(DraftInvoiceInput x, CancellationToken t) => service.GenerateAsync(x, t);
    [HttpPost("{id:guid}/refresh"), Authorize(Roles = Roles.Owner)] public Task<InvoiceView> Refresh(Guid id, InvoiceFinalizeInput x, CancellationToken t) => service.RefreshAsync(id, x.ExpectedVersion, t);
}

[ApiController, Route("api/v1/billing-schedules"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(16384)]
public sealed class BillingSchedulesController(InvoiceService service) : ControllerBase
{
    [HttpGet("{locationId:guid}")] public Task<BillingSchedule?> Get(Guid locationId, CancellationToken t) => service.ScheduleAsync(locationId, t);
    [HttpPut] public Task<BillingSchedule> Save(BillingScheduleWrite x, CancellationToken t) => service.SaveScheduleAsync(x, t);
}
