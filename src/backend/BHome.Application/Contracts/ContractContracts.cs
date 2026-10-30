using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Billing;

namespace BHome.Application.Contracts;

public sealed record ContractDraftInput(Guid RoomId, Guid OwnerSignerId, Guid TenantUserId,
    Guid RepresentativeResidentId, [Required, MinLength(1), MaxLength(50)] Guid[] ResidentIds,
    DateOnly StartDate, DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit,
    [Required, StringLength(12000, MinimumLength = 1)] string Terms, Guid? HoldingContractId = null);
public sealed record RenewalInput(DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [Required, StringLength(12000, MinimumLength = 1)] string Terms);
public sealed record ContractId(Guid Id);
public sealed record SigningInput(Guid CertificateId);
public sealed record DepositInput([Required, StringLength(150, MinimumLength = 1)] string BankTransactionReference,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount, [Required, StringLength(2000, MinimumLength = 1)] string VerificationReason);
public sealed record TerminationInput(DateOnly ProposedDate,
    [Required, StringLength(2000, MinimumLength = 1)] string Reason);
public sealed record InspectionScheduleInput(DateTimeOffset ScheduledAt);
public sealed record InspectionInput(Guid ElectricityReadingId, Guid WaterReadingId,
    [Required, StringLength(4000, MinimumLength = 1)] string Notes,
    [Required, MinLength(1), MaxLength(5)] Guid[] EvidenceIds);
public sealed record SettlementInput([Required, StringLength(2000, MinimumLength = 1)] string Decision);
public sealed record CompletionInput(DateOnly ActualEndDate);
public sealed record SigningRecoveryInput([Required, StringLength(200, MinimumLength = 1)] string ProviderReference);
public sealed record SignatureView(Guid Id, Guid SignerUserId, string Status, DateTimeOffset? SignedAt);
public sealed record ContractView(Guid Id, Guid RoomId, string Kind, string Status, DateOnly StartDate, DateOnly EndDate,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit, string Terms, Guid? PreviousContractId,
    IReadOnlyList<Guid> ResidentIds, IReadOnlyList<SignatureView> Signatures, DateTimeOffset? ActivatedAt,
    Guid OwnerSignerId, Guid TenantUserId, Guid RepresentativeResidentId, Guid? HoldingContractId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AppliedHoldingDeposit);
public sealed record ActivationReadiness(bool Ready, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal VerifiedDeposit, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RemainingDeposit,
    IReadOnlyList<string> Blockers);
public sealed record MoveOutView(Guid Id, string Status, DateOnly ProposedDate, string Reason,
    DateTimeOffset? InspectionScheduledAt, string PendingReason, string? InspectionNotes = null,
    DateTimeOffset? InspectedAt = null, Guid? ElectricityReadingId = null, Guid? WaterReadingId = null,
    IReadOnlyList<Guid>? EvidenceIds = null);
public sealed record SettlementReviewView(Guid Id, string Decision, bool Settled, Guid ReviewedByUserId, DateTimeOffset ReviewedAt);

public sealed class ContractException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static ContractException Missing() => new(404, "contract_resource_not_found");
    public static ContractException Conflict(string code) => new(409, code);
    public static ContractException Invalid(string code) => new(400, code);
}

// All PDF input comes from the immutable server snapshot. No uploaded arbitrary PDF can replace signed terms.
public sealed record ContractDocument(Guid ContractId, Guid RoomId, Guid OwnerSignerId, Guid TenantUserId,
    Guid RepresentativeResidentId, Guid[] ResidentIds, DateOnly StartDate, DateOnly EndDate, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RequiredDeposit, Guid? HoldingContractId, decimal AppliedHoldingDeposit, string Terms, string SnapshotHash);
public sealed record SigningPreparation(byte[] SourcePdf, byte[] PreparedPdf, string FieldName, string DocumentDigest,
    string DataToSignDigest, string CertificateChain, string ProviderUserId, string CredentialId);
public sealed record SigningOutcome(string State, byte[]? SignedPdf = null);
public interface IContractSigningProvider
{
    Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t);
    Task<string> RequestAsync(ContractSignature signature, CancellationToken t);
    Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t);
}
public interface IContractDocumentRenderer
{
    Task<byte[]> RenderAsync(ContractDocument document, CancellationToken t);
}
public interface IContractFileStore
{
    Task PutAsync(Guid roomId, string key, byte[] bytes, string contentType, CancellationToken t);
}
public interface IContractImageValidator { string Validate(byte[] content); }

// Implemented by the invoice/payment/deposit module. A caller's confirmation or screenshot cannot satisfy this gate.
public sealed record SettlementLedgerState(bool AllObligationsResolved, bool DepositResolved,
    bool TransfersVerified, string DecisionReference);
public interface IContractSettlementLedger
{
    Task<SettlementLedgerState?> ReadAsync(Guid contractId, Guid electricityReadingId, Guid waterReadingId, CancellationToken t);
}

public sealed record HoldingDepositApplication(Guid HoldingContractId, Guid RoomId, Guid TenantUserId,
    decimal AppliedAmount, string AllocationReference);
// The BF-03A adapter MUST validate signed/active/unexpired Holding + verified funds, then durably
// allocate/convert in the SAME DbContext transaction as the Main Contract. No remote financial mutation here.
public interface IContractHoldingLedger
{
    Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId,
        Guid tenantUserId, decimal requiredDeposit, CancellationToken t);
}

public interface IContractRepository
{
    Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t);
    Task FlushAsync(CancellationToken t);
    Task<Contract?> FindAsync(Guid id, CancellationToken t);
    Task<Room?> RoomAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t);
    Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t);
    Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t);
    Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t);
    Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t);
    Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t);
    Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t);
    Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly on, CancellationToken t);
    Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t);
    void Add(object entity);
    void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at);
}
