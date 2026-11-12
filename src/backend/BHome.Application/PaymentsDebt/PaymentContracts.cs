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
    [property: JsonRequired] bool HumanVerified, bool IsDevelopmentDemo = false, Guid? ProposedDepositContractId = null);
public sealed record PaymentMatchInput(Guid InvoiceId, Guid? PaidByUserId, [property: JsonRequired] bool HumanVerified);
public sealed record PaymentDepositMatchInput(Guid ContractId, Guid? PaidByUserId, [property: JsonRequired] bool HumanVerified,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PaidByResidentId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ExternalPayerAttestationId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ExpectedReference = null);
public sealed record PaymentRejectInput([Required, StringLength(2000)] string Reason);
public sealed record PaymentScope(Guid ActorId, bool Owner, bool Tenant, bool Staff, DateOnly Today);
public sealed record DebtSummary(
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OverdueAmount,
    int InvoiceCount, int OverdueInvoiceCount);
public sealed class PaymentQuery
{
    public Guid? DepositContractId { get; set; }
    public Guid? SettlementContractId { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public DateOnly? BillingPeriod { get; set; }
    public bool OverdueOnly { get; set; }
    public bool OutstandingOnly { get; set; }
    public string? PaymentStatus { get; set; }
    public Guid[]? InvoiceIds { get; set; }
}
public sealed record PaymentHistoryView(Guid Id,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    DateTimeOffset PaidAt, string PaidBy, Guid? PaidByUserId, string VerificationSource, DateTimeOffset VerifiedAt);
public sealed record InvoicePaymentView(Guid InvoiceId, string PaymentStatus,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal PayableAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal PaidAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    DateOnly DueDate, int OverdueDays, string TransferReference, bool PendingReview, IReadOnlyList<PaymentHistoryView> History,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OriginalIssuedAmount = 0,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal ApprovedAdjustmentTotal = 0,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal PotentialExcessAmount = 0,
    int FinancialVersion = 0, string ReviewStatus = "None");
public sealed record TransferView(Guid Id, string ProviderIdentity, string BankReference,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    string Currency, DateTimeOffset OccurredAt, string TransferDescription, string StatementReference,
    string VerificationReason, Guid VerifiedByUserId, DateTimeOffset VerifiedAt, Guid? ProposedInvoiceId,
    string Status, string Reason, Guid? AllocatedInvoiceId, bool IsDevelopmentDemo,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal AllocatedAmount = 0,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal UnallocatedAmount = 0,
    Guid? AllocatedDepositContractId = null, Guid? AllocatedSettlementContractId = null, Guid? AllocatedSettlementReceivableId = null);
public sealed record PaymentLedgerEntry(PaymentAllocation Allocation, PaymentTransfer Transfer, bool ExternalPayerVerified = false);
public sealed record PaymentReviewResult(string Status, string Reason, Guid TransferId, Guid? InvoiceId, Guid? DepositContractId = null);
public sealed record ReconciliationView(long Sequence, Guid? InvoiceId, string Decision, string Reason, Guid ActorId, DateTimeOffset OccurredAt);
public sealed record PayerChoice(Guid UserId, string DisplayLabel);
public sealed record DebtInvoiceView(Guid InvoiceId, Guid LocationId, Guid RoomId, string LocationName, string RoomNumber, DateOnly BillingPeriod, DateOnly DueDate,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PayableAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PaidAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    string PaymentStatus, int OverdueDays,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? OriginalIssuedAmount = null,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ApprovedAdjustmentTotal = null,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PotentialExcessAmount = null);
public sealed record PaymentHistoryEntry(Guid Id, Guid InvoiceId, Guid LocationId, Guid RoomId, string LocationName, string RoomNumber, DateOnly BillingPeriod,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    DateTimeOffset PaidAt, string PaidBy, string VerificationSource, string? BankReference, Guid? VerifiedByUserId);
public sealed class PaymentException(int status, string code) : Exception("Payment operation rejected.")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
public interface IPaymentRepository
{
    Task<bool> ProviderReferenceReceivedAsync(string reference, CancellationToken token) => Task.FromResult(false);
    Task<bool> ManualReferenceReceivedAsync(string reference, CancellationToken token) => Task.FromResult(false);
    Task<IReadOnlyList<DepositPayerChoice>> DepositPayersAsync(Guid contractId, CancellationToken token);
    Task<bool> VerifiedReceiptAsync(Guid transferId, CancellationToken token);
    Task<ExternalPaymentPayer?> ExternalPayerAsync(Guid transferId, CancellationToken token);
    Task RecordDepositReceiptAsync(DepositReceiptAllocation record, CancellationToken token);
    Task<bool> ExternalPayerRecordedAsync(Guid transferId, CancellationToken token);
    bool AmountMismatchSupported => false;
    Task<T> TransactionAsync<T>(Guid? transferId, Guid? invoiceId, Func<Task<T>> work, CancellationToken t);
    Task<T> DepositTransactionAsync<T>(Guid transferId, Guid contractId, Func<Task<T>> work, CancellationToken t);
    Task<Invoice?> InvoiceAsync(Guid id, PaymentScope scope, CancellationToken t);
    Task<PaymentTransfer?> TransferAsync(Guid id, CancellationToken t);
    Task<PaymentTransfer?> TransferReferenceAsync(string provider, string reference, CancellationToken t);
    Task<PaymentAllocation?> AllocationAsync(Guid transferId, CancellationToken t);
    Task<PaymentReconciliation?> LatestReviewAsync(Guid transferId, CancellationToken t);
    Task<IReadOnlyList<PaymentLedgerEntry>> HistoryAsync(Guid invoiceId, CancellationToken t);
    Task<decimal> AllocatedAsync(Guid invoiceId, CancellationToken t);
    Task<decimal> DepositAllocatedAsync(Guid contractId, CancellationToken t);
    Task<BHome.Domain.TenantContracts.Contract?> HoldingAsync(Guid contractId, CancellationToken t);
    Task<BHome.Application.Billing.InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t);
    Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t);
    Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t);
    Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t);
    Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t);
    Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t);
    Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t);
    Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId, CancellationToken t);
    Task<bool> ActiveLocationAsync(Guid locationId, CancellationToken t);
    Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId, CancellationToken t);
    Task<PagedResult<DebtInvoiceView>> DebtAsync(PaymentScope scope, PaymentQuery query, CancellationToken t);
    Task<DebtSummary> DebtSummaryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t);
    Task<PagedResult<PaymentHistoryEntry>> PaymentHistoryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid target, DateTimeOffset at);
}
