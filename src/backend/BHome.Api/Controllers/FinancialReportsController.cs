using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/financial-reports"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class FinancialReportsController(FinancialReportService service) : ControllerBase
{
    [HttpGet] public Task<FinancialReport> Get([FromQuery] ReportFilter filter, CancellationToken token) => service.ReadAsync(filter, token);
    [HttpGet("depreciation-sources")]
    public Task<DepreciationSourcePage> DepreciationSources([FromQuery] ReportFilter filter, CancellationToken token,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25) => service.DepreciationSourcesAsync(filter, page, pageSize, token);
    [HttpGet("sources")]
    public Task<FinanceSourcePage> Sources([FromQuery] ReportFilter filter, [FromQuery] string kind,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken token = default) =>
        service.SourcesAsync(filter, kind, page, pageSize, token);
    [HttpGet("bank-receipt-sources")]
    public Task<BankReceiptSourcePage> BankReceiptSources([FromQuery] ReportFilter filter, CancellationToken token,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25) => service.BankReceiptSourcesAsync(filter, page, pageSize, token);
    [HttpGet("bank-refund-sources")]
    public Task<BankRefundSourcePage> BankRefundSources([FromQuery] ReportFilter filter, CancellationToken token,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25) => service.BankRefundSourcesAsync(filter, page, pageSize, token);
}
