using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using System.Text.Json.Serialization;
namespace BHome.Application.Contracts;

public sealed record HandoverAssetInput(Guid Id, string Condition);
public sealed record HandoverInput(int Version, DateOnly Date, string RoomCondition, string KeysAndAccess,
    string Notes, HandoverAssetInput[] Assets, Guid ElectricityReadingId, Guid WaterReadingId, Guid[] EvidenceIds);
public sealed record HandoverDecision(int Version, string Note);
public sealed record HandoverAsset(Guid Id, string Name, string InventoryCondition, string ObservedCondition);
public sealed record HandoverReading(Guid Id, string MeterCode, int UtilityType, DateOnly Date,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Value,
    Guid EvidenceId, [property: JsonIgnore] string EvidenceObjectKey, string EvidenceHash);
public sealed record HandoverSnapshot(DateOnly Date, string RoomNumber, string RoomCondition, string KeysAndAccess,
    string Notes, HandoverAsset[] Assets, HandoverReading Electricity, HandoverReading Water, Guid[] EvidenceIds);
public sealed record HandoverView(int Version, string Status, HandoverSnapshot Snapshot, int? TenantConfirmedVersion,
    DateTimeOffset? TenantConfirmedAt, DateTimeOffset? StaffConfirmedAt);
public sealed record HandoverHistoryView(int Version, string Action, Guid ActorId, DateTimeOffset OccurredAt, string Note, HandoverSnapshot Snapshot);
public sealed record HandoverChoices(IReadOnlyList<HandoverAsset> Assets, IReadOnlyList<HandoverReading> Readings, IReadOnlyList<ContractDocumentView> Evidence);

public interface IContractHandoverRepository
{
    Task<ContractHandover?> GetAsync(Guid contractId, CancellationToken t);
    Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t);
    Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid roomId, DateOnly startDate, CancellationToken t);
    Task<HandoverReading?> ReadingAsync(Guid roomId, Guid readingId, CancellationToken t);
    Task<IReadOnlyList<ContractHandoverHistory>> HistoryAsync(Guid contractId, CancellationToken t);
    Task<bool> HistoryContainsEvidenceAsync(Guid contractId, Guid evidenceId, CancellationToken t);
    Task<string?> HistoryForReadingAsync(Guid contractId, Guid readingId, CancellationToken t);
}
