using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt;

public sealed record PaymentTransferInput([Required, StringLength(80)] string ProviderIdentity,
    [Required, StringLength(150)] string BankReference,
    [property: JsonRequired, JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    [Required] string Currency, DateTimeOffset OccurredAt,
    [StringLength(100)] string TransferDescription, [Required, StringLength(500)] string StatementReference,
    [Required, StringLength(2000)] string VerificationReason, Guid? ProposedInvoiceId,
    [property: JsonRequired] bool HumanVerified, bool IsDevelopmentDemo = false);
public sealed record PaymentMatchInput(Guid InvoiceId, Guid? PaidByUserId, [property: JsonRequired] bool HumanVerified);
public sealed record PaymentRejectInput([Required, StringLength(2000)] string Reason);
public sealed record PaymentScope(Guid ActorId, bool Owner, bool Tenant, bool Staff, DateOnly Today);
public sealed class PaymentQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public DateOnly? BillingPeriod { get; set; }
    public bool OverdueOnly { get; set; }
    public bool OutstandingOnly { get; set; }
}
public sealed record PaymentHistoryView(Guid Id,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    DateTimeOffset PaidAt, string PaidBy, Guid? PaidByUserId, string VerificationSource, DateTimeOffset VerifiedAt);
public sealed record InvoicePaymentView(Guid InvoiceId, string PaymentStatus,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal PayableAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal PaidAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    DateOnly DueDate, int OverdueDays, string TransferReference, bool PendingReview, IReadOnlyList<PaymentHistoryView> History);
public sealed record TransferView(Guid Id, string ProviderIdentity, string BankReference,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    string Currency, DateTimeOffset OccurredAt, string TransferDescription, string StatementReference,
    string VerificationReason, Guid VerifiedByUserId, DateTimeOffset VerifiedAt, Guid? ProposedInvoiceId,
    string Status, string Reason, Guid? AllocatedInvoiceId, bool IsDevelopmentDemo);
public sealed record PaymentLedgerEntry(PaymentAllocation Allocation, PaymentTransfer Transfer);
public sealed record PaymentReviewResult(string Status, string Reason, Guid TransferId, Guid? InvoiceId);
public sealed record ReconciliationView(long Sequence, Guid? InvoiceId, string Decision, string Reason, Guid ActorId, DateTimeOffset OccurredAt);
public sealed record PayerChoice(Guid UserId,string DisplayLabel);
public sealed class PaymentException(int status, string code) : Exception("Payment operation rejected.")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
public interface IPaymentRepository
{
    Task<T> TransactionAsync<T>(Guid? transferId, Guid? invoiceId, Func<Task<T>> work, CancellationToken t);
    Task<Invoice?> InvoiceAsync(Guid id, PaymentScope scope, CancellationToken t);
    Task<PaymentTransfer?> TransferAsync(Guid id, CancellationToken t);
    Task<PaymentTransfer?> TransferReferenceAsync(string provider, string reference, CancellationToken t);
    Task<PaymentAllocation?> AllocationAsync(Guid transferId, CancellationToken t);
    Task<PaymentReconciliation?> LatestReviewAsync(Guid transferId, CancellationToken t);
    Task<IReadOnlyList<PaymentLedgerEntry>> HistoryAsync(Guid invoiceId, CancellationToken t);
    Task<decimal> AllocatedAsync(Guid invoiceId, CancellationToken t);
    Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t);
    Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t);
    Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t);
    Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t);
    Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t);
    Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t);
    Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId,CancellationToken t);
    Task<bool> ActiveLocationAsync(Guid locationId,CancellationToken t);
    Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId,CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid target, DateTimeOffset at);
}
