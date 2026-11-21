using BHome.Application.Finance;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Authorize(Roles = Roles.Owner), Route("api/v1")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class RefundsController(RefundService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty;
    [HttpGet("payment-transactions/{id:guid}/refunds")]
    public Task<RefundSource> Source(Guid id, CancellationToken t) => service.SourceAsync(id, t);
    [HttpPost("payment-transactions/{id:guid}/refunds")]
    public Task<RefundView> Create(Guid id, RefundInput input, CancellationToken t) => service.CreateAsync(id, input, Key(), t);
    [HttpGet("contracts/{id:guid}/deposit-refunds")]
    public Task<RefundSource> DepositSource(Guid id, CancellationToken t) => service.DepositSourceAsync(id, t);
    [HttpPost("contracts/{id:guid}/deposit-refunds")]
    public Task<RefundView> CreateDeposit(Guid id, DepositRefundInput input, CancellationToken t) => service.CreateDepositAsync(id, input, Key(), t);
    [HttpPost("refund-requests/{id:guid}/decision")]
    public Task<RefundView> Decision(Guid id, RefundDecision input, CancellationToken t) => service.DecideAsync(id, input, Key(), t);
    [HttpPost("refund-requests/{id:guid}/execution"), Consumes("multipart/form-data"), RequestSizeLimit(5 * 1024 * 1024 + 32768)]
    public async Task<RefundView> Execute(Guid id, [FromForm] ExecutionForm input, CancellationToken t)
    {
        if (input.Evidence is null) throw new FinanceException(400, "refund_evidence_required");
        await using var file = input.Evidence.OpenReadStream();
        return await service.ExecuteAsync(id, new(input.ExpectedVersion, input.ExecutedAt, input.ExternalReference, input.Reason,
            input.HumanConfirmed), Key(), file, t);
    }
    [HttpGet("refund-requests/{id:guid}/evidence")]
    public async Task<IActionResult> Evidence(Guid id, CancellationToken t)
    {
        using var bytes = new MemoryStream(); var type = await service.CopyAsync(id, bytes, t);
        return File(bytes.ToArray(), type, type == "image/png" ? "chung-tu-hoan.png" : "chung-tu-hoan.jpg");
    }
    public sealed class ExecutionForm
    {
        public int ExpectedVersion { get; set; }
        public DateTimeOffset ExecutedAt { get; set; }
        public string ExternalReference { get; set; } = "";
        public string Reason { get; set; } = "";
        public bool HumanConfirmed { get; set; }
        public IFormFile? Evidence { get; set; }
    }
}
