using System.Text.Json.Serialization;
namespace BHome.Application.PaymentsDebt;

public sealed record MainInitialCharge(string Code, string Name,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount);
public sealed record MainInitialOrder(Guid ContractId, Guid LocationId, string SnapshotHash,
    decimal RequiredDeposit, decimal MonthlyRent, MainInitialCharge[] Charges, DateTimeOffset CreatedAt);
public sealed record MainInitialPaymentView(Guid ContractId, string Availability, string ContractStatus, bool SigningComplete,
    IReadOnlyList<MainInitialCharge> Charges,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal RequiredDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal HoldingCredit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal VerifiedDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal VerifiedRentAndFees,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    bool Paid, string? TransferReference, string? BankIdentifier, string? AccountNumber, string? AccountHolder,
    string? QrImageDataUri, bool IsDevelopmentDemo);

public interface IMainInitialPayments
{
    Task<MainInitialPaymentView> GetAsync(Guid contractId, bool issueQr, CancellationToken token);
}
// No actor-dependent service calls: used inside existing payment/contract transactions.
public interface IMainInitialPaymentLedger
{
    Task<MainInitialOrder?> ReadAsync(Guid contractId, CancellationToken token);
    Task<bool> SatisfiedAsync(Guid contractId, CancellationToken token);
    Task AllocateAsync(Guid contractId, BHome.Domain.PaymentsDebt.PaymentTransfer receipt, CancellationToken token);
}
