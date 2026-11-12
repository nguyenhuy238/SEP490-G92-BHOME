using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt.SePay;

public sealed record PaymentCode(string Code, string Mode, string Kind, Guid ObligationId, Guid LocationId);
public interface IPaymentCodeRegistry
{
    Task<string?> GetAsync(string kind, Guid id, CancellationToken token);
    Task<string?> IssueAsync(string kind, Guid id, Guid locationId, CancellationToken token);
    Task<bool> MatchesAsync(string kind, Guid id, string description, CancellationToken token);
}
public sealed record SePayEvent(Guid Id, string Mode, SePayTransaction Transaction, string Status, string? Reason, Guid? TransferId);
public sealed record SePayEventView(Guid Id, string Mode, string Status, string? Reason, Guid? TransferId, DateTimeOffset ReceivedAt);
public interface ISePayRepository
{
    Task<Guid> ReceiveAsync(SePayTransaction transaction, CancellationToken token);
    Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token);
    Task<SePayEvent> EventAsync(Guid id, CancellationToken token);
    Task<PaymentCode?> ResolveAsync(string code, CancellationToken token);
    Task LockTargetAsync(PaymentCode code, CancellationToken token);
    Task<Invoice?> InvoiceAsync(Guid id, CancellationToken token);
    Task<bool> DemoInvoiceAsync(Guid id, CancellationToken token);
    Task AddReceiptAsync(SePayEvent received, PaymentTransfer receipt, CancellationToken token);
    Task FinishAsync(SePayEvent received, string status, string reason, Guid? receipt, CancellationToken token);
    Task<PagedResult<SePayEventView>> EventsAsync(int page, int pageSize, CancellationToken token);
}
