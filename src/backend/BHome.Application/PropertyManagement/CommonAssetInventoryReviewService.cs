using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

public sealed record CommonAssetInventoryItem(Guid Id, string Name, string Category, string CommonArea,
    int Quantity, string? Unit, bool Checked, string? BlockedReason,
    IReadOnlyList<RoomInventoryReviewEvidence> Evidence,
    decimal? ReferenceUnitCost = null, decimal? AcquisitionUnitCost = null);
public sealed record CommonAssetInventoryView(Guid? RequirementsId, int RequirementsVersion, string StateToken,
    string State, int CheckedCount, int TotalCount, DateTimeOffset? ReviewedAt,
    IReadOnlyList<CommonAssetInventoryItem> Items);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CommonAssetInventoryInputItem(Guid ItemId, [property: JsonRequired] bool Checked, Guid[] EvidenceIds,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal? UnitCost = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CommonAssetInventoryConfirm(Guid RequestId, Guid RequirementsId, int RequirementsVersion,
    string StateToken, CommonAssetInventoryInputItem[] Items, [property: JsonRequired] bool Confirmed);

/// <summary>
/// Owner's physical attestation for location-wide configured assets. A verified group maps
/// to exactly one native Asset (RoomId=null, CommonArea set). No quantity or condition is
/// accepted from the attestation request; the configured quantity is authoritative.
/// </summary>
public sealed class CommonAssetInventoryReviewService(ISetupWorkspaceStore store, ICurrentUser user,
    ResourceAccess access, PropertyService properties,
    ISharedConfigurationStore? shared = null) : SetupWorkspaceService(store, user, access)
{
    private const string ReviewKind = "CommonAssetInventoryReview";
    private const string VerificationKind = "CommonAssetInventoryVerification";
    private const string CommandKind = "CommonAssetInventoryCommand";
    private const string DefaultCondition = "Hoạt động tốt";

    private sealed record Verification(Guid ItemId, Guid? AssetId, string Fingerprint,
        Guid[] EvidenceIds, Guid RequestId);
    private sealed record ReviewRecord(Guid RequirementsId, int RequirementsVersion, Guid RequestId);
    private sealed record Physical(Asset Asset, AssetMetadata Metadata);
    private sealed record ItemState(SetupCommonAssetRequirement Requirement, string Fingerprint,
        SetupDocument? Verification, Verification? Data, Physical[] Candidates, Physical? Linked,
        string? BlockedReason, bool Checked, RoomInventoryReviewEvidence[] Evidence);
    private sealed record Snapshot(SetupDocument? Requirements, SetupDocument? Review,
        ItemState[] Items, CommonAssetInventoryView View,
        IReadOnlyDictionary<Guid, SetupDocument> Evidence);

    private static Guid ReviewKey(Guid location) => Key($"common-asset-inventory-review:{location:N}");
    private static Guid VerificationKey(Guid location, Guid item) => Key($"common-asset-inventory-verification:{location:N}:{item:N}");
    private static Guid CommandKey(Guid location, Guid actor, Guid request) =>
        Key($"common-asset-inventory-command:{location:N}:{actor:N}:{request:N}");
    private static string Fingerprint(SetupCommonAssetRequirement item) => Hash(new
    {
        item.Id,
        item.Name,
        item.Category,
        item.CommonArea,
        item.Quantity,
        item.Unit
    });
    private static bool Equal(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
    private static bool SameDescription(Physical physical, SetupCommonAssetRequirement item) =>
        Equal(physical.Asset.Name, item.Name) && Equal(physical.Asset.Category, item.Category) &&
        Equal(physical.Asset.CommonArea, item.CommonArea);
    private static bool SameInventory(Physical physical, SetupCommonAssetRequirement item) =>
        SameDescription(physical, item) && physical.Asset.Status == AssetStatus.Active &&
        physical.Metadata.Quantity == item.Quantity && Equal(physical.Metadata.Unit, item.Unit);
    private static bool IsValidEvidence(SetupDocument document, Guid location)
    {
        if (document.Kind != "Evidence" || document.LocationId != location ||
            !document.Data.TryGetProperty("objectKey", out var key) || key.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("contentType", out var type) || type.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("length", out var length) || !length.TryGetInt32(out var bytes) ||
            !document.Data.TryGetProperty("hash", out var hash) || hash.ValueKind != JsonValueKind.String)
            return false;
        return BHome.Application.Storage.PrivateImageKeys.IsSetup(location, key.GetString()) &&
            type.GetString() is "image/png" or "image/jpeg" && bytes is > 0 and <= 5 * 1024 * 1024 &&
            hash.GetString() is { Length: 64 } digest && digest.All(Uri.IsHexDigit);
    }
    private static RoomInventoryReviewEvidence EvidenceView(SetupDocument document) => new(
        document.Id, document.Data.GetProperty("contentType").GetString() ?? "image/jpeg",
        document.RecordedAt, document.RecordedBy);

    private async Task<Snapshot> SnapshotAsync(Guid location, Guid[] additionalEvidenceIds, CancellationToken t)
    {
        var requirements = await Store.GetAsync(LocationSetupKeys.CommonAssets(location), "CommonAssetRequirements", t);
        var physical = (await Store.ReviewCommonAssetsAsync(location, t))
            .Select(row => new Physical(row.Asset, row.Metadata)).ToArray();
        var verifications = (await Store.ListAsync(location, VerificationKind, t))
            .ToDictionary(row => row.Id);
        var review = await Store.GetAsync(ReviewKey(location), ReviewKind, t);
        var items = requirements is null ? [] : Read<CommonAssetRequirementsWrite>(requirements).Items;
        var fallbackPrices = shared is not null && items.Any(item => item.ReferencePrice is null)
            ? await InventoryReferencePrices.ReadAsync(shared, "Location", t)
            : new Dictionary<string, decimal>();
        var evidenceIds = additionalEvidenceIds.Concat(verifications.Values
            .SelectMany(doc => Read<Verification>(doc).EvidenceIds)).Distinct().ToArray();
        var evidence = evidenceIds.Length == 0 ? [] :
            await Store.EvidenceDocumentsAsync(location, evidenceIds, t);
        var validEvidence = evidence.Where(doc => IsValidEvidence(doc, location)).ToDictionary(doc => doc.Id);

        var states = items.Select(item =>
        {
            var key = VerificationKey(location, item.Id);
            var document = verifications.GetValueOrDefault(key);
            var data = document is null ? null : Read<Verification>(document);
            var signature = Fingerprint(item);
            var candidates = physical.Where(row => SameDescription(row, item)).ToArray();
            var linked = data?.AssetId is { } assetId ? physical.SingleOrDefault(row => row.Asset.Id == assetId) : null;
            var duplicatedConfiguration = items.Any(other => other.Id != item.Id &&
                Equal(other.Name, item.Name) && Equal(other.Category, item.Category) &&
                Equal(other.CommonArea, item.CommonArea));
            var conflict = duplicatedConfiguration || candidates.Length > 1 ||
                candidates.Length == 1 && !SameInventory(candidates[0], item) ||
                linked is not null && !SameInventory(linked, item) ||
                data?.AssetId is not null && linked is null;
            var checkedItem = document?.Status == "Verified" && data?.Fingerprint == signature &&
                linked is not null && SameInventory(linked, item);
            var photos = (data?.EvidenceIds ?? []).Where(validEvidence.ContainsKey)
                .Take(5).Select(id => EvidenceView(validEvidence[id])).ToArray();
            return new ItemState(item, signature, document, data, candidates, linked,
                conflict ? "common_asset_mismatch" : null, checkedItem, photos);
        }).ToArray();
        var checkedCount = states.Count(item => item.Checked);
        var state = states.Any(item => item.BlockedReason is not null) ? "NeedsReview" :
            states.Length > 0 && checkedCount == states.Length ? "Matched" :
            checkedCount > 0 || review is not null ? "PartiallyChecked" : "NotChecked";
        var token = Hash(new
        {
            requirements = requirements is null ? null : new { requirements.Id, requirements.Version },
            physical = physical.OrderBy(p => p.Asset.Id).Select(p => new
            {
                p.Asset.Id,
                p.Asset.Version,
                p.Asset.Name,
                p.Asset.Category,
                p.Asset.CommonArea,
                p.Asset.RoomId,
                p.Asset.Status,
                p.Metadata.Quantity,
                p.Metadata.Unit,
                p.Metadata.PurchaseCost,
                p.Metadata.PurchaseDate
            }),
            verification = verifications.Values.OrderBy(doc => doc.Id).Select(doc => new { doc.Id, doc.Version, doc.Status }),
            reviewVersion = review?.Version ?? 0
        });
        var view = new CommonAssetInventoryView(requirements?.Id, requirements?.Version ?? 0,
            token, state, checkedCount, states.Length, review?.RecordedAt,
            states.Select(item => new CommonAssetInventoryItem(item.Requirement.Id, item.Requirement.Name,
                item.Requirement.Category, item.Requirement.CommonArea, item.Requirement.Quantity,
                item.Requirement.Unit, item.Checked, item.BlockedReason, item.Evidence,
                item.Requirement.ReferencePrice ?? InventoryReferencePrices.Suggest(
                    fallbackPrices, item.Requirement.Name, item.Requirement.Category, item.Requirement.Unit),
                item.Linked?.Metadata.PurchaseCost ??
                (item.Candidates.Length == 1 ? item.Candidates[0].Metadata.PurchaseCost : null))).ToArray());
        return new(requirements, review, states, view, validEvidence);
    }

    public async Task<CommonAssetInventoryView> GetAsync(Guid location, CancellationToken t)
    {
        Owner();
        _ = await properties.GetLocationAsync(location, t);
        return (await SnapshotAsync(location, [], t)).View;
    }

    public async Task<CommonAssetInventoryView> ConfirmAsync(Guid location, CommonAssetInventoryConfirm input,
        CancellationToken t)
    {
        Owner();
        _ = await properties.GetLocationAsync(location, t);
        if (input is null || input.RequestId == Guid.Empty || input.RequirementsId == Guid.Empty ||
            input.RequirementsVersion < 1 || !input.Confirmed || string.IsNullOrWhiteSpace(input.StateToken) ||
            input.StateToken.Length > 128 || input.Items is null || input.Items.Length is < 1 or > 100 ||
            input.Items.Any(item => item is null || item.ItemId == Guid.Empty || item.EvidenceIds is null ||
                item.EvidenceIds.Length > 5 || item.EvidenceIds.Any(id => id == Guid.Empty) ||
                item.EvidenceIds.Distinct().Count() != item.EvidenceIds.Length ||
                !item.Checked && (item.EvidenceIds.Length > 0 || item.UnitCost.HasValue) ||
                !InventoryAcquisitionPrice.Valid(item.UnitCost)) ||
            input.Items.Select(item => item.ItemId).Distinct().Count() != input.Items.Length)
            throw new PropertyException(400, "invalid_common_asset_inventory_review");
        var evidenceIds = input.Items.SelectMany(item => item.EvidenceIds).ToArray();
        if (evidenceIds.Distinct().Count() != evidenceIds.Length)
            throw new PropertyException(400, "inventory_review_evidence_duplicate_or_limit");

        var actor = Actor;
        var commandKey = CommandKey(location, actor, input.RequestId);
        var fingerprint = Hash(input);
        await Store.TransactionAsync(location, async () =>
        {
            var previousCommand = await Store.GetAsync(commandKey, CommandKind, t);
            if (previousCommand is not null)
            {
                if (previousCommand.Data.GetProperty("fingerprint").GetString() != fingerprint)
                    throw new PropertyException(409, "idempotency_payload_mismatch");
                return true;
            }
            var snapshot = await SnapshotAsync(location, evidenceIds, t);
            if (snapshot.View.RequirementsId != input.RequirementsId ||
                snapshot.View.RequirementsVersion != input.RequirementsVersion ||
                snapshot.View.StateToken != input.StateToken)
                throw new PropertyException(409, "inventory_review_state_changed");
            if (input.Items.Length != snapshot.Items.Length ||
                input.Items.Any(item => !snapshot.Items.Any(known => known.Requirement.Id == item.ItemId)))
                throw new PropertyException(400, "inventory_review_items_incomplete");
            if (evidenceIds.Any(id => !snapshot.Evidence.ContainsKey(id)))
                throw new PropertyException(400, "inventory_review_evidence_invalid");

            var evidenceOwners = snapshot.Items.Where(item => item.Data is not null)
                .SelectMany(item => item.Data!.EvidenceIds.Select(id => (Id: id, ItemId: item.Requirement.Id)))
                .GroupBy(pair => pair.Id).ToDictionary(group => group.Key, group => group.First().ItemId);
            var newAssets = new List<AssetInventoryCreation>();
            var pricedExisting = new List<(Guid AssetId, AssetMetadata Metadata)>();
            var writes = new List<SetupDocumentWrite>();
            foreach (var state in snapshot.Items)
            {
                var choice = input.Items.Single(row => row.ItemId == state.Requirement.Id);
                if (choice.Checked && state.BlockedReason is not null)
                    throw new PropertyException(409, "common_asset_mismatch");
                foreach (var id in choice.EvidenceIds)
                    if (evidenceOwners.TryGetValue(id, out var ownerItem) && ownerItem != state.Requirement.Id)
                        throw new PropertyException(409, "inventory_evidence_already_attached");
                var target = state.Linked ?? state.Candidates.SingleOrDefault();
                if (choice.Checked && target is null)
                {
                    var asset = new Asset
                    {
                        LocationId = location,
                        RoomId = null,
                        CommonArea = state.Requirement.CommonArea,
                        Name = state.Requirement.Name,
                        Category = state.Requirement.Category,
                        Condition = DefaultCondition,
                        Status = AssetStatus.Active
                    };
                    asset.Code = $"INV-{asset.Id:N}";
                    var metadata = new AssetMetadata("BulkQuantity", state.Requirement.Quantity,
                        choice.UnitCost, null, null, state.Requirement.Unit);
                    newAssets.Add(new(asset, metadata, "Owner confirmed configured common-area asset group"));
                    target = new(asset, metadata);
                }
                if (choice.Checked && target is not null)
                {
                    if (target.Metadata.PurchaseCost is { } recordedPrice &&
                        choice.UnitCost is { } requestedPrice && recordedPrice != requestedPrice)
                        throw new PropertyException(409, "asset_acquisition_price_locked");
                    var isNew = newAssets.Any(asset => asset.Asset.Id == target.Asset.Id);
                    if (isNew || target.Metadata.PurchaseCost is null && choice.UnitCost.HasValue)
                    {
                        var metadata = target.Metadata with { PurchaseCost = choice.UnitCost };
                        var previousMetadata = isNew ? null :
                            await Store.GetAsync(target.Asset.Id, "AssetMetadata", t);
                        writes.Add(new(target.Asset.Id, "AssetMetadata", "Recorded",
                            InventoryAcquisitionPrice.MetadataSnapshot(metadata),
                            previousMetadata?.Version ?? 0));
                        if (!isNew) pricedExisting.Add((target.Asset.Id, metadata));
                    }
                }
                // Already checked groups keep their durable physical identity. A recheck that
                // finds a missing group marks the verification Missing without deleting assets.
                var nextStatus = choice.Checked ? "Verified" : "Missing";
                var next = new Verification(state.Requirement.Id, target?.Asset.Id,
                    state.Fingerprint, choice.EvidenceIds, input.RequestId);
                var prior = state.Verification;
                var old = state.Data;
                var changed = prior is null || prior.Status != nextStatus || old?.AssetId != next.AssetId ||
                    old?.Fingerprint != next.Fingerprint ||
                    !(old?.EvidenceIds ?? []).Order().SequenceEqual(next.EvidenceIds.Order());
                if (changed)
                    writes.Add(new(VerificationKey(location, state.Requirement.Id), VerificationKind,
                        nextStatus, next, prior?.Version ?? 0));
            }
            await Store.SaveInventoryAssetsAsync(location, newAssets, actor, t);
            foreach (var update in pricedExisting)
                await Store.SaveAssetMetadataAsync(update.AssetId, update.Metadata, t);
            var review = new ReviewRecord(input.RequirementsId, input.RequirementsVersion, input.RequestId);
            if (writes.Count > 0 || snapshot.Review is null)
                writes.Add(new(ReviewKey(location), ReviewKind, "Recorded", review,
                    snapshot.Review?.Version ?? 0));
            writes.Add(new(commandKey, CommandKind, "Completed", new { fingerprint, input.RequestId }, 0));
            await Store.SaveBatchAsync(location, writes, actor, t);
            return true;
        }, t);
        return await GetAsync(location, t);
    }
}
