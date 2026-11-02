using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
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
    [HttpPost("{id:guid}/allocate")] public Task<PaymentReviewResult> Allocate(Guid id, PaymentMatchInput input, CancellationToken t) => service.AllocateAsync(id, input, Key(), t);
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
