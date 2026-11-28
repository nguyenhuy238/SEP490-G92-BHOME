using BHome.Application.PropertyManagement;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt.SePay;

public sealed record PaymentCode(string Code, string Mode, string Kind, Guid ObligationId, Guid LocationId,
    ReceivingBankAccount? AccountSnapshot = null, string? InstanceCode = null, bool SnapshotPending = false);
public sealed record SePaySettlementTarget(Guid ContractId, Guid LocationId, SettlementReceivable Charge,
    decimal OutstandingAmount, bool MayAllocate = false, string? Blocker = null);
public interface IPaymentCodeRegistry
{
    Task<string?> GetAsync(string kind, Guid id, CancellationToken token);
    Task FreezeAsync(Guid invoiceId, Guid locationId, CancellationToken token) => Task.CompletedTask;
    Task<string?> IssueAsync(string kind, Guid id, Guid locationId, CancellationToken token);
    Task<bool> MatchesAsync(string kind, Guid id, string description, CancellationToken token);
    Task<PaymentCode?> ContextAsync(string kind, Guid id, CancellationToken token) => Task.FromResult<PaymentCode?>(null);
    async Task<string?> PersistedModeAsync(string kind, Guid id, CancellationToken token) => (await ContextAsync(kind, id, token))?.Mode;
    Task<ReceivingBankAccount?> AccountAsync(string kind, Guid id, Guid locationId, CancellationToken token) =>
        Task.FromResult<ReceivingBankAccount?>(null);
}
public sealed record SePayEvent(Guid Id, string Mode, SePayTransaction Transaction, string Status, string? Reason, Guid? TransferId, Guid? OwnerId = null);
public sealed record SePayEventView(Guid Id, string Mode, string Status, string? Reason, Guid? TransferId, DateTimeOffset ReceivedAt);
public sealed record SePayVerifiedMoveOutCandidate(Guid ContractId, Guid ReceivableId);
public interface ISePayRepository
{
    Task<Guid> ReceiveAsync(SePayTransaction transaction, CancellationToken token);
    Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token);
    Task<SePayEvent> EventAsync(Guid id, CancellationToken token);
    Task<PaymentCode?> ResolveAsync(string code, CancellationToken token);
    Task LockTargetAsync(PaymentCode code, CancellationToken token);
    Task<Invoice?> InvoiceAsync(Guid id, CancellationToken token);
    Task<bool> DemoInvoiceAsync(Guid id, CancellationToken token);
    Task<SePaySettlementTarget?> SettlementAsync(Guid receivableId, CancellationToken token);
    Task AddReceiptAsync(SePayEvent received, Payment receipt, CancellationToken token);
    Task FinishAsync(SePayEvent received, string status, string reason, Guid? receipt, CancellationToken token);
    Task<PagedResult<SePayEventView>> EventsAsync(int page, int pageSize, CancellationToken token);
    Task<IReadOnlyList<SePayVerifiedMoveOutCandidate>> VerifiedMoveOutCandidatesAsync(CancellationToken token);
}
