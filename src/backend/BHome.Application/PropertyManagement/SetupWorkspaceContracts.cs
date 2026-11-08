using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PropertyManagement;

// Versioned documents use existing Compact24 JSON containers; physical assets and money remain native records.
public sealed record SetupDocument(Guid Id, Guid LocationId, string Kind, string Status, int Version, JsonElement Data, DateTimeOffset? RecordedAt = null);
public interface ISetupWorkspaceStore
{
    Task<T> TransactionAsync<T>(Guid locationId, Func<Task<T>> work, CancellationToken t);
    Task<SetupDocument?> GetAsync(Guid id, string kind, CancellationToken t);
    Task<IReadOnlyList<SetupDocument>> ListAsync(Guid locationId, string kind, CancellationToken t);
    Task<SetupDocument> SaveAsync(Guid id, Guid locationId, string kind, string status, object data, int expectedVersion, Guid actor, CancellationToken t);
    Task<Guid?> RoomLocationAsync(Guid roomId, CancellationToken t);
    Task<IReadOnlyList<Guid>> RoomsAsync(Guid locationId, CancellationToken t);
    Task<bool> EligibleRoomAsync(Guid roomId, CancellationToken t);
    Task<Asset?> AssetAsync(Guid id, CancellationToken t);
    Task SaveAssetAsync(Asset asset, Guid actor, string reason, CancellationToken t);
    Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t);
    Task SaveAssetMetadataAsync(Guid assetId, AssetMetadata metadata, CancellationToken t);
    Task<IReadOnlyDictionary<Guid, AssetMetadata>> AssetMetadataAsync(Guid[] assetIds, CancellationToken t);
    Task<IReadOnlyList<AssetHistoryEntry>> AssetHistoryAsync(Guid assetId, CancellationToken t);
    Task<Contract?> ContractAsync(Guid id, CancellationToken t);
    Task SaveContractAsync(Contract contract, Guid actor, string action, CancellationToken t);
    Task NotifyPolicyPublicationAsync(Guid locationId, Guid policyId, CancellationToken t);
    Task<string?> EvidenceHashAsync(string objectKey, CancellationToken t);
    Task<string> UploadEvidenceAsync(Guid locationId, byte[] bytes, string contentType, Guid actor, CancellationToken t);
    Task<IReadOnlyList<UtilityRoomUsage>> UtilityUsageAsync(Guid locationId, UtilityType type, DateOnly period, CancellationToken t);
    Task<(Guid LocationId, UtilityType Type)?> MeterScopeAsync(Guid meterId, CancellationToken t);
}
public sealed record AssetTemplateItem(Guid Id, string Name, string Category, string TrackingMode, int Quantity);
public sealed record AssetTemplateWrite(Guid LocationId, string Name, AssetTemplateItem[] Items, int ExpectedVersion = 0);
public sealed record TemplatePublish(int ExpectedVersion);
public sealed record AssetTemplateAssignment(Guid? TemplateId, int ExpectedVersion = 0);
public sealed record DesiredAssets(Guid TemplateId, int TemplateVersion, Guid RoomId, AssetTemplateItem[] Items, string Status);
public sealed record AssetSyncRoom(Guid RoomId, string Status);
public sealed record AssetSyncRun(Guid TemplateId, int TemplateVersion, IReadOnlyList<AssetSyncRoom> Rooms, Guid? RunId = null);
public sealed record AssetHistoryEntry(Guid Id, string Action, string Reason, DateTimeOffset OccurredAt, Guid ActorId, string Snapshot);
public sealed record AssetVerification(Guid TemplateId, Guid ItemId, string Code, int Quantity, string Condition, string EvidenceObjectKey, int ExpectedVersion, Guid? ExistingAssetId = null);
public sealed record AssetMetadata(string TrackingMode, int Quantity, decimal? PurchaseCost, DateOnly? PurchaseDate, int? UsefulLifeMonths);
public sealed record AssetMetadataWrite(AssetMetadata Metadata, int ExpectedVersion, string Reason);
public sealed record AssetReplacement(string Code, string Condition, string Reason, int ExpectedVersion);
public sealed record AssetDiscrepancy(Guid AssetId, string Action);
public sealed record AssetInventory(IReadOnlyList<Asset> Physical, IReadOnlyList<SetupDocument> Desired, IReadOnlyDictionary<Guid, AssetMetadata>? Metadata = null,
    Guid? CurrentDesiredId = null, IReadOnlyList<AssetDiscrepancy>? Discrepancies = null);

public sealed record UtilityTier(decimal? Through, decimal Rate);
public sealed record UtilityTariffWrite(Guid LocationId, [property: JsonRequired] UtilityType UtilityType, DateOnly EffectiveFrom, DateOnly? EffectiveTo,
    string Supplier, string Classification, string SourceReference, UtilityTier[] Tiers, [property: JsonRequired] VndRounding Rounding, bool Verified,
    Guid? ReplacesId = null);
public sealed record UtilityMeterLink(Guid MeterId, Guid? ParentMeterId, string Scope, DateOnly EffectiveFrom, DateOnly? EffectiveTo);
public sealed record UtilitySourceMeter(Guid LocationId, UtilityType UtilityType, string Scope, string Code, Guid? ParentMeterId);
public sealed record UtilitySourceReading(Guid MeterId, DateOnly Period, [property: JsonRequired] decimal Opening, [property: JsonRequired] decimal Closing, string EvidenceObjectKey, bool HumanConfirmed);
public sealed record UtilityRoomUsage(Guid RoomId, Guid MeterId, Guid ReadingId, decimal Consumption);
public sealed record UtilityQuotaWrite(Guid LocationId, Guid RoomId, [property: JsonRequired] UtilityType UtilityType, DateOnly Period,
    [property: JsonRequired] decimal FreeQuantity, string SourceReference, bool Verified, int ExpectedVersion = 0);
public sealed record UtilityProfileWrite(Guid LocationId, Guid RoomId, [property: JsonRequired] UtilityType UtilityType, Guid TariffId,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo, [property: JsonRequired] bool RequireQuota, [property: JsonRequired] bool RequireReconciliation, int ExpectedVersion = 0, Guid? ReplacesId = null);
public sealed record UtilitySourceBill(Guid LocationId, Guid MeterId, [property: JsonRequired] UtilityType UtilityType, DateOnly Period,
    [property: JsonRequired] decimal Consumption, [property: JsonRequired] decimal Amount, string Reference, string EvidenceObjectKey);
public sealed record UtilityReconcileInput(Guid LocationId, Guid SourceBillId, [property: JsonRequired] decimal Tolerance, string Reason, int ExpectedVersion = 0);
public sealed record UtilityReconciliation(Guid SourceBillId, decimal SourceConsumption, decimal RoomConsumption, decimal CommonConsumption,
    decimal Variance, decimal Tolerance, string Status, string Reason, string InputsHash);
public sealed record UtilityCalculation(decimal Amount, string Snapshot, IReadOnlyList<string> MissingInputs);
public sealed record UtilityPeriodSegment(DateOnly From, DateOnly To, Guid TariffId, decimal Consumption, decimal FreeQuantity, string EvidenceObjectKey);
public sealed record UtilityPeriodBreakdown(Guid LocationId, Guid RoomId, UtilityType UtilityType, DateOnly Period, UtilityPeriodSegment[] Segments, bool HumanConfirmed, int ExpectedVersion = 0);
public sealed record UtilityVarianceReview(bool AcceptVariance, string Reason, int ExpectedVersion);
public interface IUtilityBilling
{
    Task<UtilityCalculation?> CalculateAsync(Guid roomId, UtilityType type, DateOnly period, decimal quantity, CancellationToken t);
}
public sealed record OperatingPolicyWrite(Guid LocationId, string Title, string Content, DateOnly EffectiveFrom, int ExpectedVersion = 0);
public sealed record OperatingPolicyBinding(Guid PolicyId, int Version, string ContentHash, string Title, string Content);
public sealed record AgreedOperatingPolicy(Guid ContractId, string Status, OperatingPolicyBinding? Policy, Guid? AmendmentId);
public sealed record PolicyAmendmentInput(Guid PolicyId, DateOnly EffectiveFrom, string Reason);
public sealed record PolicyAmendmentCancellation(string Reason);
public interface IOperatingPolicyWorkflow
{
    Task BindDraftAsync(Contract contract, CancellationToken t);
    Task<AgreedOperatingPolicy> AgreedAsync(Guid contractId, CancellationToken t);
    Task<Guid> AmendAsync(Guid contractId, PolicyAmendmentInput input, Guid key, CancellationToken t);
    Task ApplyAmendmentAsync(Contract contract, CancellationToken t);
}

public static class UtilityTariffMath
{
    public static decimal Calculate(decimal quantity, IReadOnlyList<UtilityTier> tiers, VndRounding rounding)
    {
        if (quantity < 0 || quantity > 1_000_000_000m || !Enum.IsDefined(rounding) || tiers.Count is < 1 or > 50)
            throw new PropertyException(400, "invalid_utility_tariff");
        decimal previous = 0, amount = 0;
        for (var i = 0; i < tiers.Count; i++)
        {
            var tier = tiers[i];
            if (tier is null) throw new PropertyException(400, "invalid_utility_tiers");
            if (tier.Rate < 0 || tier.Rate > 1_000_000_000m ||
                (i == tiers.Count - 1 ? tier.Through is not null : tier.Through is null || tier.Through <= previous))
                throw new PropertyException(400, "invalid_utility_tiers");
            var units = Math.Max(0, Math.Min(quantity, tier.Through ?? quantity) - previous);
            amount += units * tier.Rate;
            previous = tier.Through ?? quantity;
        }
        return decimal.Round(amount, 0, rounding == VndRounding.AwayFromZero ? MidpointRounding.AwayFromZero : MidpointRounding.ToEven);
    }
}
