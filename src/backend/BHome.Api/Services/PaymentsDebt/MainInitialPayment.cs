using System.Text.Json.Serialization;
namespace BHome.Application.PaymentsDebt;

public sealed record MainInitialCharge(string Code, string Name,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount);
public sealed record MainInitialOrder(Guid ContractId, Guid LocationId, string SnapshotHash,
    decimal RequiredDeposit, decimal MonthlyRent, MainInitialCharge[] Charges, DateTimeOffset CreatedAt,
    Guid? SharedDepositContractId = null, Guid? SharedRentContractId = null, Guid? SharedInvoiceId = null,
    bool RoomScopeResolved = false, string? RoomScopeMode = null, int CalculationVersion = 1);
public sealed record MainInitialMeteredRate(string Code, string Name, string Unit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Rate);
public sealed record MainInitialPaymentView(Guid ContractId, string Availability, string ContractStatus, bool SigningComplete,
    IReadOnlyList<MainInitialCharge> Charges,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal FirstMonthRent,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal RequiredDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal HoldingCredit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal VerifiedDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal VerifiedRentAndFees,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    bool Paid, string? TransferReference, string? BankIdentifier, string? AccountNumber, string? AccountHolder,
    string? QrImageDataUri, bool IsDevelopmentDemo,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingDeposit,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingRentAndFees,
    IReadOnlyList<MainInitialMeteredRate> MeteredRates);

public interface IMainInitialPayments
{
    Task<MainInitialPaymentView> GetAsync(Guid contractId, bool issueQr, CancellationToken token);
}
// No actor-dependent service calls: used inside existing payment/contract transactions.
public interface IMainInitialPaymentLedger
{
    Task<MainInitialOrder?> ReadAsync(Guid contractId, CancellationToken token);
    Task<(decimal Deposit, decimal RentAndFees)> OutstandingAsync(MainInitialOrder order, CancellationToken token);
    Task<Guid?> PendingSharedContractAsync(MainInitialOrder order, CancellationToken token);
    Task<bool> SatisfiedAsync(Guid contractId, CancellationToken token);
    Task AllocateAsync(Guid contractId, BHome.Domain.PaymentsDebt.Payment receipt, CancellationToken token);
}
