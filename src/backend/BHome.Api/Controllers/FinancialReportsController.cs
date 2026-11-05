using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/financial-reports"), Authorize(Roles=Roles.Owner)]
[ResponseCache(NoStore=true,Location=ResponseCacheLocation.None)]
public sealed class FinancialReportsController(FinancialReportService service) : ControllerBase
{
    [HttpGet] public Task<FinancialReport> Get([FromQuery] ReportFilter filter,CancellationToken token)=>service.ReadAsync(filter,token);
}
