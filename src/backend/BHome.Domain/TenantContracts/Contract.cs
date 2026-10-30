using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.TenantContracts;

public enum ContractKind { Main, Renewal }
public enum ContractStatus { Draft, PendingSigning, PendingActivation, Active, Terminated, Superseded, Cancelled }
public enum SignatureStatus { Prepared, Dispatching, Pending, Signed, Failed, ManualReview }
public enum MoveOutStatus { Requested, Approved, Inspected, PendingSettlement, Settled, Completed }

// Signed versions are never edited. A renewal is a new version of the same tenancy.
public sealed class Contract : AuditableEntity
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid OwnerSignerId { get; set; }
    public Guid TenantUserId { get; set; }
    public Guid RepresentativeResidentId { get; set; }
    public Guid? PreviousContractId { get; set; }
    public Guid? HoldingContractId { get; set; }
    public decimal AppliedHoldingDeposit { get; set; }
    public string? HoldingAllocationReference { get; set; }
    public ContractKind Kind { get; set; }
    public ContractStatus Status { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public decimal MonthlyRent { get; set; }
    public decimal RequiredDeposit { get; set; }
    public string Terms { get; set; } = "";
    public string SnapshotHash { get; set; } = "";
    public List<ContractResident> Residents { get; set; } = [];
    public List<ContractSignature> Signatures { get; set; } = [];
    public Guid? ActivatedByUserId { get; set; }
    public DateTimeOffset? ActivatedAt { get; set; }
    public DateOnly? ActualEndDate { get; set; }
}

public sealed class ContractResident
{
    public Guid ContractId { get; set; }
    public Guid ResidentId { get; set; }
    public ResidentType Role { get; set; }
    public DateOnly ResidenceFrom { get; set; }
    public DateOnly? ResidenceTo { get; set; }
}

public sealed class ContractSignature : AuditableEntity
{
    public Guid ContractId { get; set; }
    public Guid SignerUserId { get; set; }
    public Guid CertificateId { get; set; }
    public SignatureStatus Status { get; set; }
    public string SnapshotHash { get; set; } = "";
    public string SourceHash { get; set; } = "";
    public string PreparedHash { get; set; } = "";
    public string PreparedObjectKey { get; set; } = "";
    public string FieldName { get; set; } = "";
    public string DocumentDigest { get; set; } = "";
    public string DataToSignDigest { get; set; } = "";
    public string CertificateChain { get; set; } = "";
    public string ProviderUserId { get; set; } = "";
    public string CredentialId { get; set; } = "";
    public string? ProviderReference { get; set; }
    public string? SignedObjectKey { get; set; }
    public string? SignedHash { get; set; }
    public DateTimeOffset? SignedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

// A durable bank verification, not a screenshot or a client-supplied paid flag.
public sealed class DepositVerification : AuditableEntity
{
    public Guid ContractId { get; set; }
    public string BankTransactionReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string VerificationReason { get; set; } = "";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
}

public sealed class ContractMoveOut : AuditableEntity
{
    public Guid ContractId { get; set; }
    public MoveOutStatus Status { get; set; }
    public DateOnly ProposedDate { get; set; }
    public string Reason { get; set; } = "";
    public bool IsExpiry { get; set; }
    public Guid RequestedByUserId { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public DateTimeOffset? InspectionScheduledAt { get; set; }
    public Guid? InspectedByUserId { get; set; }
    public DateTimeOffset? InspectedAt { get; set; }
    public string? InspectionNotes { get; set; }
    public Guid? ElectricityReadingId { get; set; }
    public Guid? WaterReadingId { get; set; }
    public string? SettlementDecision { get; set; }
    public Guid? SettlementApprovedByUserId { get; set; }
    public DateTimeOffset? SettlementApprovedAt { get; set; }
    public string? SettlementLedgerReference { get; set; }
    public string PendingReason { get; set; } = "inspection_and_financial_dependencies";
}

public sealed class ContractInspectionEvidence : AuditableEntity
{
    public Guid ContractId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public bool IsLinked { get; set; }
}

public sealed class ContractSettlementReview : AuditableEntity
{
    public Guid ContractId { get; set; }
    public string Decision { get; set; } = "";
    public string? LedgerReference { get; set; }
    public bool Settled { get; set; }
    public Guid ReviewedByUserId { get; set; }
    public DateTimeOffset ReviewedAt { get; set; }
}

// Durable upload intent, written in its own transaction before object storage is called.
public sealed class ContractFileUpload
{
    public string ObjectKey { get; set; } = "";
    public Guid RoomId { get; set; }
    public DateTimeOffset CleanupAfter { get; set; }
}

// Exact retry identity and result are committed with the domain effect.
public sealed class ContractOperation
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public string Operation { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public Guid ResultId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
