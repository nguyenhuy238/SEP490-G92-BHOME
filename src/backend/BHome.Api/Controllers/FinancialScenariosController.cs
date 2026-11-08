using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/financial-scenarios"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class FinancialScenariosController(FinancialScenarioService service) : ControllerBase
{
    [HttpPost("analyze")] public Task<ScenarioView> Analyze(ScenarioInput input, CancellationToken t) => service.AnalyzeAsync(input, t);
    [HttpPost]
    public Task<ScenarioView> Save(ScenarioInput input, CancellationToken t) => service.SaveAsync(input,
        Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
    [HttpGet] public Task<IReadOnlyList<ScenarioSummary>> List(int page = 1, int pageSize = 25, CancellationToken t = default) => service.ListAsync(page, pageSize, t);
    [HttpGet("{id:guid}")] public Task<ScenarioView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
}
