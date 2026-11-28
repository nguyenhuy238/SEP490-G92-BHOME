using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.TenantContracts;

// A durable bank verification, not a screenshot or a client-supplied paid flag.
public sealed class DepositVerification : AuditableEntity
{
    internal static DepositVerification Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt,
        Guid contractId, string reference, decimal amount, string reason, Guid verifier, DateTimeOffset verifiedAt) =>
        new()
        {
            Id = id,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt,
            ContractId = contractId,
            BankTransactionReference = reference,
            Amount = amount,
            VerificationReason = reason,
            VerifiedByUserId = verifier,
            VerifiedAt = verifiedAt
        };
    public Guid ContractId { get; set; }
    public string BankTransactionReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string VerificationReason { get; set; } = "";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
}

public sealed class ContractMoveOut : AuditableEntity
{
    internal static ContractMoveOut Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid ContractId { get; set; }
    public MoveOutStatus Status { get; set; }
    public DateOnly ProposedDate { get; set; }
    public string Reason { get; set; } = "";
    public bool IsExpiry { get; set; }
    public Guid RequestedByUserId { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public DateTimeOffset? InspectionScheduledAt { get; set; }
    public Guid? InspectionStaffId { get; set; }
    public int Version { get; set; } = 1;
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
    internal static ContractInspectionEvidence Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid ContractId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public bool IsLinked { get; set; }
}

public sealed class ContractSettlementReview : AuditableEntity
{
    internal static ContractSettlementReview Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid ContractId { get; set; }
    public string Decision { get; set; } = "";
    public string? LedgerReference { get; set; }
    public bool Settled { get; set; }
    public Guid ReviewedByUserId { get; set; }
    public DateTimeOffset ReviewedAt { get; set; }
    public string FinancialSnapshot { get; set; } = "{}";
}
public sealed class ContractMoveOutHistory : AuditableEntity
{
    internal static ContractMoveOutHistory Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid ContractId { get; set; }
    public int Version { get; set; }
    public string Action { get; set; } = "";
    public string Snapshot { get; set; } = "{}";
    public Guid ActorId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
public sealed class ContractFinalInspection : AuditableEntity
{
    internal static ContractFinalInspection Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid ContractId { get; set; }
    public int Version { get; set; }
    public Guid BaselineContractId { get; set; }
    public int BaselineVersion { get; set; }
    public string BaselineSnapshot { get; set; } = "{}";
    public string ObservedSnapshot { get; set; } = "{}";
    public Guid StaffId { get; set; }
    public DateTimeOffset InspectedAt { get; set; }
    public string? OwnerDecision { get; set; }
    public string? OwnerReason { get; set; }
    public Guid? OwnerId { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public bool NoAdditionalCharges { get; set; }
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
