using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/tenant/refund-requests"), Authorize(Roles = Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TenantRefundPetitionsController(TenantRefundPetitionService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key)
        ? key : Guid.Empty;

    [HttpGet]
    public Task<PagedResult<TenantRefundPetitionView>> List([FromQuery] int page = 1,
        [FromQuery] int pageSize = 20, CancellationToken token = default) =>
        service.TenantListAsync(page, pageSize, token);

    [HttpGet("sources")]
    public Task<TenantRefundPetitionSources> Sources(CancellationToken token) => service.SourcesAsync(token);

    [HttpPost, RequestSizeLimit(32768)]
    public Task<TenantRefundPetitionView> Create(TenantRefundPetitionInput input, CancellationToken token) =>
        service.CreateAsync(input, Key(), token);

    [HttpGet("{id:guid}/evidence")]
    public async Task<IActionResult> Evidence(Guid id, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var type = await service.CopyEvidenceAsync(id, bytes, true, token);
        return File(bytes.ToArray(), type, type == "image/png" ? "chung-tu-hoan.png" : "chung-tu-hoan.jpg");
    }
}

[ApiController, Route("api/v1/owner/tenant-refund-requests"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OwnerTenantRefundPetitionsController(TenantRefundPetitionService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key)
        ? key : Guid.Empty;

    [HttpGet]
    public Task<PagedResult<TenantRefundPetitionView>> List([FromQuery] int page = 1,
        [FromQuery] int pageSize = 20, CancellationToken token = default) =>
        service.OwnerListAsync(page, pageSize, token);

    [HttpPost("{id:guid}/decision"), RequestSizeLimit(32768)]
    public Task<TenantRefundPetitionView> Decision(Guid id, TenantRefundPetitionDecision input,
        CancellationToken token) => service.DecideAsync(id, input, Key(), token);

    [HttpPost("{id:guid}/execution"), Consumes("multipart/form-data"),
     RequestSizeLimit(5 * 1024 * 1024 + 32768)]
    public async Task<TenantRefundPetitionView> Execute(Guid id, [FromForm] TenantRefundExecutionForm form,
        CancellationToken token)
    {
        if (form.Evidence is null || form.Evidence.Length == 0)
            throw new FinanceException(400, "refund_evidence_required");
        if (form.Evidence.Length > 5 * 1024 * 1024)
            throw new FinanceException(413, "refund_evidence_too_large");
        if (form.Evidence.ContentType is not ("image/png" or "image/jpeg"))
            throw new FinanceException(415, "refund_evidence_type_invalid");
        await using var file = form.Evidence.OpenReadStream();
        return await service.ExecuteAsync(id, new(form.ExpectedVersion, form.ExecutedAt,
            form.ExternalReference, form.Reason, form.HumanConfirmed), Key(), file, token);
    }

    [HttpGet("{id:guid}/evidence")]
    public async Task<IActionResult> Evidence(Guid id, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var type = await service.CopyEvidenceAsync(id, bytes, false, token);
        return File(bytes.ToArray(), type, type == "image/png" ? "chung-tu-hoan.png" : "chung-tu-hoan.jpg");
    }

    public sealed class TenantRefundExecutionForm
    {
        public int ExpectedVersion { get; set; }
        public DateTimeOffset ExecutedAt { get; set; }
        public string ExternalReference { get; set; } = "";
        public string Reason { get; set; } = "";
        public bool HumanConfirmed { get; set; }
        public IFormFile? Evidence { get; set; }
    }
}
