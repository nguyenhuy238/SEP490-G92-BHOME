using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Billing;

[ApiController, Route("api/v1/invoice-adjustments"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(32768)]
public sealed class InvoiceAdjustmentsController(AdjustmentService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty ? key : throw new AdjustmentException(400, "idempotency_key_required");
    [HttpGet] public Task<PagedResult<AdjustmentView>> List([FromQuery] AdjustmentQuery q, CancellationToken t) => service.ListAsync(q, t);
    [HttpGet("{id:guid}")] public Task<AdjustmentView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPost("/api/v1/invoices/{invoiceId:guid}/adjustment-requests"), Authorize(Policy = Permissions.InvoiceAdjustments.Request)]
    public Task<AdjustmentView> Submit(Guid invoiceId, AdjustmentSubmit x, CancellationToken t) => service.SubmitAsync(invoiceId, x, Key(), t);
    [HttpPut("/api/v1/invoices/{invoiceId:guid}/adjustment-evidence"), Authorize(Policy = Permissions.InvoiceAdjustments.Request), RequestSizeLimit(5242880)]
    public Task<AdjustmentEvidenceView> Upload(Guid invoiceId, CancellationToken t) => service.UploadAsync(invoiceId, Request.Body, t);
    [HttpGet("{id:guid}/evidence/{evidenceId:guid}")]
    public async Task<IActionResult> Evidence(Guid id, Guid evidenceId, CancellationToken t)
    {
        var stream = new MemoryStream(); var mime = await service.CopyEvidenceAsync(id, evidenceId, stream, t); stream.Position = 0;
        return File(stream, mime, mime == "image/png" ? "bang-chung.png" : "bang-chung.jpg");
    }
}
