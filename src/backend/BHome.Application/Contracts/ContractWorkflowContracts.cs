using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public interface IContractWorkflowMode { bool SimulatedSigningEnabled { get; } }
public interface IContractSigningDocumentSource
{
    // Null selects the existing sealed-template renderer for contracts without a reviewed source.
    Task<byte[]?> ReadAsync(ContractDocument document, CancellationToken t);
}
public sealed record ContractTemplateView(string Id, int Version, string Title, string Notice,
    bool Available, bool DevelopmentOnly, string? Blocker, IReadOnlyList<string> Fields);
public sealed record ContractWorkflowConfiguration(ContractTemplateView Template, string SigningMode,
    string? HoldingBlocker, string? SettlementBlocker);
public sealed record ContractChoice(Guid Id, string Label);
public sealed record ContractRoomChoice(Guid Id, string Label, Guid LocationId, string Status);
public sealed record ContractResidentChoice(Guid Id, Guid RoomId, string Label, Guid? TenantUserId, bool Verified, string ResidentType = "Representative");
public sealed record ContractPreparation(IReadOnlyList<ContractChoice> Locations, IReadOnlyList<ContractRoomChoice> Rooms,
    IReadOnlyList<ContractResidentChoice> Residents, IReadOnlyList<ContractChoice> OwnerSigners);
public sealed record TenantAccountLink(Guid TenantUserId);
public sealed record ContractDocumentView(Guid Id, Guid ContractId, string Kind, string SnapshotHash,
    string? TemplateId, int? TemplateVersion, bool DevelopmentOnly, DateTimeOffset RecordedAt);
public sealed record ContractHistoryView(string Action, Guid? ActorId, DateTimeOffset OccurredAt);
public sealed record DepositVerificationView(Guid Id, string BankTransactionReference,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount, string VerificationReason,
    Guid VerifiedByUserId, DateTimeOffset VerifiedAt);

public interface IContractWorkflowRepository
{
    Task<ContractPreparation> PreparationAsync(ContractListScope scope, Guid? locationId, CancellationToken t);
    Task<IReadOnlyList<ContractChoice>> TenantAccountsAsync(CancellationToken t);
    Task LinkTenantAsync(Guid residentId, Guid tenantId, Guid actor, DateTimeOffset at, CancellationToken t);
    Task<ContractDocumentFile?> PreviewAsync(Guid id, string hash, string template, int version, CancellationToken t);
    Task<ContractDocumentFile?> FileAsync(Guid contractId, Guid fileId, CancellationToken t);
    Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid contractId, ContractFileKind kind, CancellationToken t);
    Task<IReadOnlyList<ContractHistoryView>> HistoryAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<DepositVerificationView>> DepositsAsync(Guid id, CancellationToken t);
}
