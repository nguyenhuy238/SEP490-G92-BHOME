using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/depreciation"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class DepreciationController(DepreciationService service) : ControllerBase
{
    [HttpGet]
    public Task<DepreciationPage> List([FromQuery] Guid? locationId, CancellationToken token, [FromQuery] int page = 1, [FromQuery] int pageSize = 25) =>
        service.ListAsync(locationId, page, pageSize, token);

    [HttpGet("{id:guid}")]
    public Task<DepreciationView> Read(Guid id, CancellationToken token) => service.ReadAsync(id, token);
    [HttpGet("{id:guid}/replacement-review")]
    public Task<AssetReplacementReview> ReplacementReview(Guid id, [FromQuery] decimal? replacementCost, CancellationToken token) =>
        service.ReplacementReviewAsync(id, replacementCost, token);

    [HttpPost("{id:guid}")]
    public Task<DepreciationView> Record(Guid id, DepreciationInput input, CancellationToken token) =>
        service.RecordAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
    [HttpPost("{id:guid}/disposal")]
    public Task<DepreciationView> Dispose(Guid id, InvestmentDisposalInput input, CancellationToken token) =>
        service.DisposeAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
    [HttpPost("{id:guid}/disposal-receipts")]
    public Task<DepreciationView> Receive(Guid id, InvestmentReceiptInput input, CancellationToken token) =>
        service.ReceiveAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, token);
}
