using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using System.Text.Json.Serialization;
namespace BHome.Application.Contracts;

public sealed record HandoverAssetInput(Guid Id, string Condition, int? ObservedQuantity = null,
    int? HandedOverQuantity = null, int? GoodQuantity = null, int? WornQuantity = null,
    int? DamagedQuantity = null, int? MissingQuantity = null, bool Checked = true,
    string? Notes = null, Guid[]? EvidenceIds = null, HandoverPhysicalObservation[]? PhysicalObservations = null);
public sealed record HandoverPhysicalObservation(Guid Id, int Quantity, string Condition, int? HandedOverQuantity = null);
public sealed record HandoverInput(int Version, DateOnly Date, string RoomCondition, string KeysAndAccess,
    string Notes, HandoverAssetInput[] Assets, Guid ElectricityReadingId, Guid WaterReadingId, Guid[] EvidenceIds,
    string? InventoryToken = null);
public sealed record HandoverDecision(int Version, string Note);
public sealed record HandoverPhysicalAsset(Guid Id, int Version, int Quantity, string Condition, string Status);
public sealed record HandoverAsset(Guid Id, string Name, string InventoryCondition, string ObservedCondition,
    Guid? ConfigurationItemId = null, int? ConfiguredQuantity = null, string? Unit = null, string? TrackingMode = null,
    HandoverPhysicalAsset[]? PhysicalAssets = null, bool OwnerChecked = false, int? ObservedQuantity = null,
    int? HandedOverQuantity = null, int? GoodQuantity = null, int? WornQuantity = null,
    int? DamagedQuantity = null, int? MissingQuantity = null, bool Checked = false, string? Notes = null, Guid[]? EvidenceIds = null,
    HandoverPhysicalObservation[]? PhysicalObservations = null);
public sealed record HandoverInventory(string StateToken, string State, bool NoAssetsConfirmed, HandoverAsset[] Groups);
public sealed record HandoverOwnerReview(int Version, bool Accepted, string Reason, string HandlingPlan);
public sealed record HandoverOwnerAcceptance(int Version, Guid ActorId, DateTimeOffset At, string Reason, string HandlingPlan);
public sealed record InspectionTenantFeedback(int Version, bool Confirmed, string Reason);
public sealed record HandoverFeedback(Guid ActorId, DateTimeOffset At, bool Confirmed, string Reason);
public sealed record HandoverReading(Guid Id, string MeterCode, int UtilityType, DateOnly Date,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Value,
    Guid EvidenceId, [property: JsonIgnore] string EvidenceObjectKey, string EvidenceHash);
public sealed record HandoverSnapshot(DateOnly Date, string RoomNumber, string RoomCondition, string KeysAndAccess,
    string Notes, HandoverAsset[] Assets, HandoverReading Electricity, HandoverReading Water, Guid[] EvidenceIds,
    string? InventoryToken = null, string? InventoryState = null, bool NoAssetsConfirmed = false,
    HandoverOwnerAcceptance? OwnerAcceptance = null, HandoverFeedback? TenantFeedback = null,
    string? MissingBaselineReason = null, bool OtherTenantsRemain = false,
    IReadOnlyDictionary<Guid, string>? EvidenceHashes = null, string? ProposedCompensation = null);
public sealed record HandoverView(int Version, string Status, HandoverSnapshot Snapshot, int? TenantConfirmedVersion,
    DateTimeOffset? TenantConfirmedAt, DateTimeOffset? StaffConfirmedAt, Guid? SourceContractId = null);
public sealed record HandoverHistoryView(int Version, string Action, Guid ActorId, DateTimeOffset OccurredAt, string Note, HandoverSnapshot Snapshot);
public sealed record HandoverChoices(IReadOnlyList<HandoverAsset> Assets, IReadOnlyList<HandoverReading> Readings, IReadOnlyList<ContractDocumentView> Evidence,
    string? InventoryToken = null, string? InventoryState = null, bool NoAssetsConfirmed = false);

public interface IHandoverInventory
{
    Task<HandoverInventory> PrepareAsync(Guid roomId, CancellationToken t);
    Task MarkForReviewAsync(Guid roomId, Guid contractId, int version, Guid actor, CancellationToken t);
    Task SynchronizeAsync(Guid roomId, Guid contractId, int version, HandoverSnapshot snapshot, Guid actor, CancellationToken t);
}

public interface IContractHandoverRepository
{
    Task<ContractHandover?> GetAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t);
    Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid roomId, DateOnly startDate, CancellationToken t);
    Task<HandoverReading?> ReadingAsync(Guid roomId, Guid readingId, CancellationToken t);
    Task<IReadOnlyList<ContractHandoverHistory>> HistoryAsync(Guid contractId, CancellationToken t);
    Task<bool> HistoryContainsEvidenceAsync(Guid contractId, Guid evidenceId, CancellationToken t);
    Task<string?> HistoryForReadingAsync(Guid contractId, Guid readingId, CancellationToken t);
    Task EnsureMoveInTaskAsync(Contract contract, Guid actor, DateTimeOffset now, CancellationToken t);
    Task CompleteMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t);
    Task NotifyAsync(Contract contract, string action, Guid actor, int version, CancellationToken t);
    Task<IReadOnlyList<AssetChangeParty>> ActivePartiesAsync(Guid roomId, CancellationToken t);
    Task<IReadOnlyList<AssetChangeSource>> ChangeSourcesAsync(Guid roomId, CancellationToken t);
}
