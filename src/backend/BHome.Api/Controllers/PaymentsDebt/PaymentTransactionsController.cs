using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PaymentsDebt;

[ApiController, Route("api/v1/payment-transactions"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(16384)]
public sealed class PaymentTransactionsController(PaymentService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty ? key : throw new PaymentException(400, "idempotency_key_required");
    [HttpGet] public Task<PagedResult<TransferView>> List([FromQuery] PaymentQuery query, CancellationToken t) => service.TransfersAsync(query, t);
    [HttpGet("{id:guid}")] public Task<TransferView> Get(Guid id, CancellationToken t) => service.TransferAsync(id, t);
    [HttpPost] public Task<TransferView> Register(PaymentTransferInput input, CancellationToken t) => service.RegisterAsync(input, Key(), t);
    // A manual bank receipt with a screenshot is one operation: the payment is
    // persisted only after private storage accepts and verifies the image.
    [HttpPost("manual-with-evidence"), Consumes("multipart/form-data"), RequestSizeLimit(5 * 1024 * 1024 + 32768)]
    public async Task<TransferView> RegisterWithEvidence([FromForm] ManualBankTransferForm form, CancellationToken t)
    {
        if (form.Evidence is null || form.Evidence.Length == 0) throw new PaymentException(400, "bank_statement_image_required");
        if (form.Evidence.Length > 5 * 1024 * 1024) throw new PaymentException(413, "bank_statement_image_too_large");
        if (form.Evidence.ContentType is not ("image/png" or "image/jpeg")) throw new PaymentException(415, "bank_statement_image_type_invalid");
        PaymentTransferInput input;
        try
        {
            input = JsonSerializer.Deserialize<PaymentTransferInput>(form.Input, new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? throw new JsonException();
        }
        catch (JsonException) { throw new PaymentException(400, "invalid_payment_input"); }
        await using var evidence = form.Evidence.OpenReadStream();
        return await service.RegisterWithStatementEvidenceAsync(input, Key(), evidence, t);
    }
    [HttpGet("{id:guid}/evidence")]
    public async Task<IActionResult> StatementEvidence(Guid id, CancellationToken t)
    {
        using var bytes = new MemoryStream();
        var type = await service.CopyStatementEvidenceAsync(id, bytes, t);
        return File(bytes.ToArray(), type, type == "image/png" ? "sao-ke-ngan-hang.png" : "sao-ke-ngan-hang.jpg");
    }
    public sealed class ManualBankTransferForm
    {
        [Required] public string Input { get; set; } = "";
        [Required] public IFormFile? Evidence { get; set; }
    }
    [HttpPost("{id:guid}/allocate")] public Task<PaymentReviewResult> Allocate(Guid id, PaymentMatchInput input, CancellationToken t) => service.AllocateAsync(id, input, Key(), t);
    [HttpGet("{id:guid}/deposit-context")] public Task<DepositAllocationContext> DepositContext(Guid id, [FromQuery] Guid contractId, CancellationToken t) => service.DepositContextAsync(id, contractId, t);
    [HttpPost("{id:guid}/allocate-deposit"), HttpPost("{id:guid}/allocate-holding-deposit")] public Task<PaymentReviewResult> AllocateDeposit(Guid id, PaymentDepositMatchInput input, CancellationToken t) => service.AllocateDepositAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/reject")] public Task<PaymentReviewResult> Reject(Guid id, PaymentRejectInput input, CancellationToken t) => service.RejectAsync(id, input, Key(), t);
    [HttpGet("{id:guid}/reconciliation-history")] public Task<PagedResult<ReconciliationView>> History(Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.ReviewsAsync(id, page, pageSize, t);
}

[ApiController, Route("api/v1/invoices/{id:guid}/payment"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class InvoicePaymentController(PaymentService service) : ControllerBase
{
    [HttpGet] public Task<InvoicePaymentView> Get(Guid id, CancellationToken t) => service.InvoicePaymentAsync(id, t);
    [HttpGet("eligible-payers"), Authorize(Roles = Roles.Owner)] public Task<IReadOnlyList<PayerChoice>> Payers(Guid id, CancellationToken t) => service.PayersAsync(id, t);
}

[ApiController, Route("api/v1/contracts/{id:guid}/deposit-payment"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ContractDepositPaymentController(PaymentService service) : ControllerBase
{
    [HttpGet] public Task<ContractDepositPosition> Get(Guid id, CancellationToken token) => service.DepositPositionAsync(id, token);
}
