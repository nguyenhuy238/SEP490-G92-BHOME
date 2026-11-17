using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using Microsoft.Extensions.Logging;

namespace BHome.Application.PropertyManagement;

public sealed record RoomInventoryReviewEvidence(Guid Id, string ContentType, DateTimeOffset? UploadedAt, Guid? UploadedBy);
public sealed record RoomInventoryReviewItem(Guid Id, string Name, string Category, string? Unit, int Quantity,
    bool Checked, IReadOnlyList<RoomInventoryReviewEvidence> Evidence,
    decimal? ReferenceUnitCost = null, decimal? AcquisitionUnitCost = null);
public sealed record RoomInventoryReviewRoom(Guid RoomId, string RoomNumber, Guid? DesiredId, int DesiredVersion,
    IReadOnlyList<RoomInventoryReviewItem> Items, string State, int CheckedCount, int TotalCount,
    int UnlinkedAssetCount, string? BlockedReason, string StateToken, DateTimeOffset? ReviewedAt);
public sealed record RoomInventoryReviewView(IReadOnlyList<RoomInventoryReviewRoom> Rooms);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RoomInventoryReviewInputItem(Guid ItemId, [property: JsonRequired] bool Checked, Guid[] EvidenceIds,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal? UnitCost = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RoomInventoryReviewInputRoom(Guid RoomId, Guid? DesiredId, int DesiredVersion, string StateToken, RoomInventoryReviewInputItem[] Items);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RoomInventoryReviewConfirm(Guid RequestId, RoomInventoryReviewInputRoom[] Rooms, [property: JsonRequired] bool Confirmed);

/// <summary>
/// Owner attestation that each configured asset group was physically checked and found sufficient.
/// The configured quantity remains authoritative; only checked groups create/link one physical Asset.
/// </summary>
public sealed class RoomInventoryReviewService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access,
    PropertyService properties, ILogger<RoomInventoryReviewService> logger,
    ISharedConfigurationStore? shared = null) : SetupWorkspaceService(store, user, access)
{
    private const string ReviewKind = "RoomInventoryChecklistReview";
    private const string CommandKind = "RoomInventoryChecklistCommand";
    private const string Source = "OwnerAttestation";
    private const string DefaultCondition = "Hoạt động tốt";

    private sealed record Mapping(Guid RoomId, Guid TemplateId, Guid ItemId, Guid AssetId, int Quantity, SetupDocument Document);
    private sealed record Physical(Asset Asset, AssetMetadata Metadata);
    private sealed record ItemReview(Guid ItemId, bool Checked, Guid[] EvidenceIds);
    private sealed record ReviewRecord(Guid RoomId, Guid? DesiredId, int DesiredVersion, string Baseline,
        string State, Guid RequestId, ItemReview[] Items, Guid[] UnlinkedAssetIds);
    private sealed record ItemContext(AssetTemplateItem Requirement, Physical[] Linked, int VerifiedQuantity,
        bool Ambiguous, SetupDocument? OwnerAttestation);
    private sealed record RoomContext(Room Room, SetupDocument? Assignment, SetupDocument? Provenance,
        SetupDocument? Template, SetupDocument? Desired, DesiredAssets? Configuration, ItemContext[] Items,
        Physical[] Physical, Mapping[] Mappings, Physical[] Unlinked, bool InvalidConfiguration,
        SetupDocument? Prior, string Baseline, RoomInventoryReviewRoom View);
    private sealed record SnapshotData(RoomContext[] Rooms, IReadOnlyDictionary<Guid, SetupDocument> Evidence,
        IReadOnlyDictionary<Guid, SetupDocument> AssetMetadataDocuments, bool EvidenceRead);
    private sealed record PendingRoom(RoomContext Context, string State, bool HasReviewIssues, ItemReview[] Items,
        Physical[] PhysicalAfter, SetupDocumentWrite[] MappingWrites, SetupDocumentWrite[] MetadataWrites,
        (Guid AssetId, AssetMetadata Metadata)[] MetadataUpdates, SetupDocumentWrite? DesiredWrite, string Baseline);

    private static Guid ReviewKey(Guid room) => Key($"room-inventory-checklist:{room:N}");
    private static Guid CommandKey(Guid location, Guid actor, Guid request) => Key($"room-inventory-checklist-command:{location:N}:{actor:N}:{request:N}");
    private static Guid AttestationKey(Guid room, Guid template, Guid item, Guid asset) =>
        Key($"owner-attestation:{room:N}:{template:N}:{item:N}:{asset:N}");
    private static bool EqualText(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
    private static bool Compatible(Physical physical, AssetTemplateItem item) =>
        EqualText(physical.Asset.Name, item.Name) && EqualText(physical.Asset.Category, item.Category) &&
        (item.Unit is null || EqualText(physical.Metadata.Unit, item.Unit));
    private static Mapping ReadMapping(SetupDocument document) => new(
        document.Data.GetProperty("roomId").GetGuid(), document.Data.GetProperty("templateId").GetGuid(),
        document.Data.GetProperty("itemId").GetGuid(), document.Data.GetProperty("assetId").GetGuid(),
        document.Data.GetProperty("quantity").GetInt32(), document);
    private static Guid[] MappingEvidenceIds(SetupDocument? document, bool includeStaff = false)
    {
        if (document is null) return [];
        var ownerIds = document.Data.TryGetProperty("evidenceIds", out var owner) && owner.ValueKind == JsonValueKind.Array
            ? owner.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetGuid())
            : [];
        var staffIds = includeStaff && document.Data.TryGetProperty("staffEvidenceIds", out var staff) && staff.ValueKind == JsonValueKind.Array
            ? staff.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetGuid())
            : [];
        return ownerIds.Concat(staffIds).Distinct().ToArray();
    }
    private static bool IsValidEvidence(SetupDocument document, Guid location)
    {
        if (document.Kind != "Evidence" || document.LocationId != location ||
            !document.Data.TryGetProperty("objectKey", out var key) || key.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("contentType", out var type) || type.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("length", out var length) || !length.TryGetInt32(out var bytes) ||
            !document.Data.TryGetProperty("hash", out var hash) || hash.ValueKind != JsonValueKind.String)
            return false;
        var objectKey = key.GetString();
        var contentType = type.GetString();
        var hashValue = hash.GetString();
        return objectKey is not null && objectKey.StartsWith($"setup/{location:N}/evidence/", StringComparison.Ordinal) &&
            contentType is "image/png" or "image/jpeg" && bytes is > 0 and <= 5 * 1024 * 1024 &&
            hashValue is { Length: 64 } && hashValue.All(Uri.IsHexDigit);
    }

    private static string Baseline(Room room, bool active, bool invalid, SetupDocument? assignment,
        SetupDocument? provenance, SetupDocument? template, SetupDocument? desired,
        IEnumerable<Physical> physical, IEnumerable<Mapping> mappings) => Hash(new
        {
            room = room.Id,
            room.RoomNumber,
            room.Version,
            active,
            invalid,
            assignment = assignment is null ? null : new { assignment.Id, assignment.Version },
            provenance = provenance is null ? null : new { provenance.Id, provenance.Version },
            template = template is null ? null : new { template.Id, template.Version, template.Status },
            desired = desired is null ? null : new { desired.Id, desired.Version },
            physical = physical.OrderBy(a => a.Asset.Id).Select(a => new
            {
                a.Asset.Id,
                a.Asset.Version,
                a.Asset.LocationId,
                a.Asset.RoomId,
                a.Asset.Name,
                a.Asset.Category,
                a.Asset.Condition,
                a.Asset.Status,
                metadata = new
                {
                    a.Metadata.TrackingMode,
                    a.Metadata.Quantity,
                    a.Metadata.Unit
                }
            }),
            // Evidence-only appends by Staff must not invalidate the Owner's checkbox
            // attestation. The mapping identity and configured quantity are the stable baseline.
            mappings = mappings.OrderBy(m => m.Document.Id).Select(m => new
            {
                m.Document.Id,
                m.RoomId,
                m.TemplateId,
                m.ItemId,
                m.AssetId,
                m.Quantity
            })
        });

    private async Task<SnapshotData> SnapshotAsync(Guid location, bool active, Guid[] additionalEvidenceIds, CancellationToken t)
    {
        var started = Stopwatch.GetTimestamp();
        // Three bounded round trips: rooms, physical assets + JSONB metadata, and all setup
        // documents for this location. Evidence is fetched once in a fourth query only when used.
        var rooms = await Store.ReviewRoomsAsync(location, t);
        var physicalRows = await Store.ReviewRoomAssetsAsync(location, t);
        var physical = physicalRows.Select(x => new Physical(x.Asset, x.Metadata)).ToArray();
        var documents = await Store.ReviewDocumentsAsync(location, physical.Select(a => a.Asset.Id).ToArray(), t);
        var templates = documents.Where(d => d.Kind == "AssetTemplate").ToDictionary(d => d.Id);
        var assignments = documents.Where(d => d.Kind == "AssetTemplateAssignment").ToDictionary(d => d.Id);
        var provenance = documents.Where(d => d.Kind == "RoomProvenance").ToDictionary(d => d.Id);
        var desired = documents.Where(d => d.Kind == "DesiredAssets")
            .Select(d => (Document: d, Data: Read<DesiredAssets>(d))).ToLookup(d => d.Data.RoomId);
        var mappings = documents.Where(d => d.Kind == "AssetVerification").Select(ReadMapping).ToLookup(m => m.RoomId);
        var prior = documents.Where(d => d.Kind == ReviewKind).ToDictionary(d => d.Id);
        var metadataDocuments = documents.Where(d => d.Kind == "AssetMetadata").ToDictionary(d => d.Id);
        var byRoom = physical.ToLookup(a => a.Asset.RoomId);
        var legacyDefault = templates.Values.Where(AssetInventoryService.IsLocationDefault)
            .OrderByDescending(d => d.RecordedAt).ThenBy(d => d.Id).FirstOrDefault();
        var fallbackPrices = shared is not null && desired.SelectMany(group => group)
            .Any(d => d.Data.Items.Any(item => item.ReferencePrice is null))
            ? await InventoryReferencePrices.ReadAsync(shared, "Room", t)
            : new Dictionary<string, decimal>();
        var allReviewRecords = prior.Values.ToDictionary(d => d.Id, Read<ReviewRecord>);
        var evidenceIds = additionalEvidenceIds
            .Concat(allReviewRecords.Values.SelectMany(r => r.Items).Where(i => i.Checked).SelectMany(i => i.EvidenceIds))
            .Concat(documents.Where(d => d.Kind == "AssetVerification" &&
                d.Data.TryGetProperty("source", out var source) && source.GetString() == "OwnerAttestation")
                .SelectMany(d => MappingEvidenceIds(d, includeStaff: true)))
            .Distinct().ToArray();
        var evidenceDocuments = evidenceIds.Length == 0 ? [] : await Store.EvidenceDocumentsAsync(location, evidenceIds, t);
        var evidence = evidenceDocuments.ToDictionary(d => d.Id);
        var validEvidence = evidenceDocuments.Where(d => IsValidEvidence(d, location)).ToDictionary(d => d.Id);
        var result = new List<RoomContext>(rooms.Count);

        foreach (var room in rooms)
        {
            var assignment = assignments.GetValueOrDefault(Key($"asset-template-assignment:{room.Id}"));
            var roomProvenance = provenance.GetValueOrDefault(LocationSetupKeys.RoomProvenance(room.Id));
            var selected = assignment is null ? null : Read<AssetTemplateAssignment>(assignment).TemplateId;
            var effective = selected is { } id ? templates.GetValueOrDefault(id) :
                assignment?.Status != "None" && roomProvenance is null ? legacyDefault : null;
            var invalid = selected.HasValue && effective is null || effective is not null && effective.Status != "Published";
            var candidates = effective is null ? [] : desired[room.Id].Where(d => d.Data.TemplateId == effective.Id &&
                d.Data.TemplateVersion == effective.Version).ToArray();
            invalid |= effective is not null && candidates.Length != 1;
            var current = !invalid && candidates.Length == 1 ? candidates[0].Document : null;
            var configuration = current is null ? null : Read<DesiredAssets>(current);
            var actual = byRoom[room.Id].ToArray();
            var roomMappings = mappings[room.Id].OrderBy(m => m.Document.Id).ToArray();
            var activeIds = actual.Select(a => a.Asset.Id).ToHashSet();
            var itemIds = (configuration?.Items ?? []).Select(i => i.Id).ToHashSet();
            var activeMappings = roomMappings.Where(m => activeIds.Contains(m.AssetId) && itemIds.Contains(m.ItemId)).ToArray();
            var byAsset = activeMappings.ToLookup(m => m.AssetId);
            var byItem = activeMappings.ToLookup(m => m.ItemId);
            var items = (configuration?.Items ?? []).Select(item =>
            {
                var linkedIds = byItem[item.Id].Select(m => m.AssetId).ToHashSet();
                var linked = actual.Where(a => linkedIds.Contains(a.Asset.Id)).ToArray();
                var staleMapping = roomMappings.Any(m => m.ItemId == item.Id && !activeIds.Contains(m.AssetId));
                var ambiguous = staleMapping || linked.Length > 1 ||
                    linked.Any(a => byAsset[a.Asset.Id].Select(m => m.ItemId).Distinct().Count() != 1 || !Compatible(a, item));
                var verified = linked.Sum(a => Math.Min(a.Metadata.Quantity,
                    byItem[item.Id].Where(m => m.AssetId == a.Asset.Id && m.TemplateId == configuration!.TemplateId &&
                        m.Document.Status == "Verified")
                        .Select(m => m.Quantity).DefaultIfEmpty(0).Max()));
                var attestation = linked.Length == 1 && !ambiguous
                    ? documents.SingleOrDefault(d => d.Kind == "AssetVerification" && d.Id ==
                        AttestationKey(room.Id, configuration!.TemplateId, item.Id, linked[0].Asset.Id))
                    : null;
                return new ItemContext(item, linked, verified, ambiguous, attestation);
            }).ToArray();
            var unlinked = actual.Where(a => !activeMappings.Any(m => m.AssetId == a.Asset.Id)).ToArray();
            var previous = prior.GetValueOrDefault(ReviewKey(room.Id));
            var baseline = Baseline(room, active, invalid, assignment, roomProvenance, effective, current, actual, roomMappings);
            var saved = previous is null ? null : allReviewRecords[previous.Id];
            var matchingReview = saved is not null && saved.Baseline == baseline &&
                saved.DesiredId == current?.Id && saved.DesiredVersion == (current?.Version ?? 0);
            var savedItems = saved?.Items.ToDictionary(i => i.ItemId) ?? [];
            var itemViews = items.Select(item =>
            {
                savedItems.TryGetValue(item.Requirement.Id, out var savedItem);
                var ids = (savedItem?.EvidenceIds ?? []).Concat(MappingEvidenceIds(item.OwnerAttestation, includeStaff: true)).Distinct().ToArray();
                var itemEvidence = ids.Where(validEvidence.ContainsKey).Take(5).Select(id => EvidenceView(validEvidence[id])).ToArray();
                var verified = !item.Ambiguous && item.Linked.Length == 1 &&
                    item.Linked[0].Asset.Status == AssetStatus.Active &&
                    item.Linked[0].Metadata.Quantity == item.Requirement.Quantity &&
                    EqualText(item.Linked[0].Metadata.Unit, item.Requirement.Unit) &&
                    item.VerifiedQuantity == item.Requirement.Quantity;
                var isChecked = matchingReview && savedItem is not null ? savedItem.Checked : verified;
                return new RoomInventoryReviewItem(item.Requirement.Id, item.Requirement.Name, item.Requirement.Category,
                    item.Requirement.Unit, item.Requirement.Quantity, isChecked, itemEvidence,
                    item.Requirement.ReferencePrice ?? InventoryReferencePrices.Suggest(
                        fallbackPrices, item.Requirement.Name, item.Requirement.Category, item.Requirement.Unit),
                    item.Linked.Length == 1 ? item.Linked[0].Metadata.PurchaseCost : null);
            }).ToArray();
            var checkedCount = itemViews.Count(i => i.Checked);
            var physicalIssues = unlinked.Length > 0 || items.Any(i => i.Ambiguous ||
                i.Linked.Length == 1 && i.Linked[0].Metadata.Quantity != i.Requirement.Quantity ||
                i.Linked.Any(a => a.Asset.Status != AssetStatus.Active));
            var state = invalid || physicalIssues ? "NeedsReview" :
                configuration is null ? "NotChecked" :
                itemViews.Length > 0 && checkedCount == itemViews.Length ? "Matched" :
                checkedCount > 0 || matchingReview ? "PartiallyChecked" : "NotChecked";
            var blockedReason = !active ? "location_inactive" : invalid ? "desired_inventory_required" :
                configuration is null ? "no_asset_requirements" : physicalIssues ? "physical_assets_need_review" : null;
            var view = new RoomInventoryReviewRoom(room.Id, room.RoomNumber, current?.Id, current?.Version ?? 0,
                itemViews, state, checkedCount, itemViews.Length, unlinked.Length, blockedReason,
                Hash(new { baseline, reviewVersion = previous?.Version ?? 0 }), previous?.RecordedAt);
            result.Add(new(room, assignment, roomProvenance, effective, current, configuration, items,
                actual, roomMappings, unlinked, invalid, previous, baseline, view));
        }
        logger.LogDebug("Room inventory snapshot: rooms={RoomCount}, assets={AssetCount}, evidence={EvidenceCount}, elapsedMs={ElapsedMs:F1}, databaseReads={DatabaseReads}",
            rooms.Count, physical.Length, evidenceIds.Length, Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            evidenceIds.Length == 0 ? 3 : 4);
        return new(result.ToArray(), evidence, metadataDocuments, evidenceIds.Length > 0);
    }

    private static RoomInventoryReviewEvidence EvidenceView(SetupDocument document) => new(
        document.Id,
        document.Data.GetProperty("contentType").GetString() ?? "image/jpeg",
        document.RecordedAt,
        document.RecordedBy);

    private static RoomInventoryReviewView View(SnapshotData snapshot) => new(snapshot.Rooms.Select(r => r.View).ToArray());

    public async Task<RoomInventoryReviewView> GetAsync(Guid location, CancellationToken t)
    {
        Owner();
        var started = Stopwatch.GetTimestamp();
        var target = await properties.GetLocationAsync(location, t);
        var snapshot = await SnapshotAsync(location, target.IsActive, [], t);
        logger.LogInformation("Room inventory GET completed: rooms={RoomCount}, databaseReads={DatabaseReads}, elapsedMs={ElapsedMs:F1}",
            snapshot.Rooms.Length, 1 + 3 + (snapshot.EvidenceRead ? 1 : 0), Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        return View(snapshot);
    }

    // Finance's background valuation runs without an interactive Owner principal.
    // Reuse the same live configuration/physical-asset snapshot as the Owner
    // checklist instead of trusting a historic "Matched" document: a changed
    // room template, required quantity or retired physical asset can invalidate it.
    // This method only reads persisted data and does not confirm inventory.
    public async Task<int> CountRoomsRequiringReviewAsync(Guid location, CancellationToken t)
    {
        var snapshot = await SnapshotAsync(location, true, [], t);
        return snapshot.Rooms.Count(room => room.View.State != "Matched");
    }

    private static RoomInventoryReviewInputItem[] ValidateRoom(RoomContext context, RoomInventoryReviewInputRoom input)
    {
        if (input.DesiredId != context.View.DesiredId || input.DesiredVersion != context.View.DesiredVersion ||
            input.StateToken != context.View.StateToken)
            throw new PropertyException(409, "inventory_review_state_changed");
        if (context.InvalidConfiguration) throw new PropertyException(409, "desired_inventory_required");
        if (context.Configuration is null)
        {
            if (input.Items.Length != 0) throw new PropertyException(400, "inventory_review_items_invalid");
            return [];
        }
        if (input.Items is null || input.Items.Length != context.Items.Length ||
            input.Items.Any(i => i is null || i.ItemId == Guid.Empty || i.EvidenceIds is null ||
                i.EvidenceIds.Length > 5 || i.EvidenceIds.Any(id => id == Guid.Empty) ||
                i.EvidenceIds.Distinct().Count() != i.EvidenceIds.Length ||
                !InventoryAcquisitionPrice.Valid(i.UnitCost) ||
                !i.Checked && i.UnitCost.HasValue) ||
            input.Items.Select(i => i.ItemId).Distinct().Count() != input.Items.Length ||
            input.Items.Any(i => !context.Items.Any(c => c.Requirement.Id == i.ItemId)))
            throw new PropertyException(400, "inventory_review_items_incomplete");
        return input.Items;
    }

    private static SetupDocument PreviewDocument(Guid location, SetupDocumentWrite write, Guid actor)
    {
        var payload = JsonSerializer.SerializeToElement(write.Data, Json);
        return new(write.Id, location, write.Kind, write.Status, write.ExpectedVersion + 1, payload, null, actor);
    }

    private PendingRoom PrepareRoom(Guid location, RoomContext context, RoomInventoryReviewInputItem[] input,
        Guid requestId, IReadOnlyDictionary<Guid, SetupDocument> evidence,
        IReadOnlyDictionary<Guid, SetupDocument> priorMetadata)
    {
        var itemsById = input.ToDictionary(i => i.ItemId);
        var newAssets = new List<AssetInventoryCreation>();
        var mappingWrites = new List<SetupDocumentWrite>();
        var metadataWrites = new List<SetupDocumentWrite>();
        var metadataUpdates = new List<(Guid AssetId, AssetMetadata Metadata)>();
        var newMappings = new List<Mapping>();
        var reviewItems = new List<ItemReview>(input.Length);
        var progress = context.Items.ToDictionary(i => i.Requirement.Id, i => i.VerifiedQuantity);
        var issues = context.Unlinked.Length > 0 || context.Items.Any(i => i.Ambiguous ||
            i.Linked.Length == 1 && i.Linked[0].Metadata.Quantity != i.Requirement.Quantity ||
            i.Linked.Any(a => a.Asset.Status != AssetStatus.Active));

        foreach (var item in context.Items)
        {
            var choice = itemsById[item.Requirement.Id];
            reviewItems.Add(new(item.Requirement.Id, choice.Checked, choice.EvidenceIds));
            if (!choice.Checked) continue;

            Physical? linked = item.Linked.Length == 1 && !item.Ambiguous ? item.Linked[0] : null;
            if (linked is null && !item.Ambiguous && context.Unlinked.Length == 0)
            {
                var asset = new Asset
                {
                    LocationId = location,
                    RoomId = context.Room.Id,
                    Name = item.Requirement.Name,
                    Category = item.Requirement.Category,
                    Condition = DefaultCondition,
                    Code = ""
                };
                asset.Code = $"INV-{asset.Id:N}";
                var metadata = new AssetMetadata("BulkQuantity", item.Requirement.Quantity,
                    choice.UnitCost, null, null, item.Requirement.Unit);
                newAssets.Add(new(asset, metadata, "Owner confirmed configured asset group"));
                linked = new(asset, metadata);
            }
            else if (linked is null)
            {
                // Existing unmatched/ambiguous physical assets are never silently linked or duplicated.
                issues = true;
                continue;
            }

            // A verified acquisition price is a historic snapshot. Rechecking
            // an existing priced asset never reprices it, including a posted
            // ledger entry or a free (0 VND) acquisition.
            if (linked.Metadata.PurchaseCost is { } recordedPrice &&
                choice.UnitCost is { } requestedPrice && recordedPrice != requestedPrice)
                throw new PropertyException(409, "asset_acquisition_price_locked");
            if (newAssets.Any(asset => asset.Asset.Id == linked.Asset.Id) ||
                linked.Metadata.PurchaseCost is null && choice.UnitCost.HasValue)
            {
                var metadata = linked.Metadata with { PurchaseCost = choice.UnitCost };
                var before = priorMetadata.GetValueOrDefault(linked.Asset.Id);
                metadataWrites.Add(new(linked.Asset.Id, "AssetMetadata", "Recorded",
                    InventoryAcquisitionPrice.MetadataSnapshot(metadata), before?.Version ?? 0));
                if (!newAssets.Any(asset => asset.Asset.Id == linked.Asset.Id))
                    metadataUpdates.Add((linked.Asset.Id, metadata));
            }

            if (linked.Metadata.Quantity != item.Requirement.Quantity || linked.Asset.Status != AssetStatus.Active)
                issues = true;
            var mappedQuantity = Math.Min(linked.Metadata.Quantity, item.Requirement.Quantity);
            progress[item.Requirement.Id] = Math.Max(progress[item.Requirement.Id], mappedQuantity);
            var mappingId = AttestationKey(context.Room.Id, context.Configuration!.TemplateId, item.Requirement.Id, linked.Asset.Id);
            var previous = item.OwnerAttestation;
            if (previous is null || !SameEvidence(previous, choice.EvidenceIds) ||
                previous.Data.GetProperty("quantity").GetInt32() != mappedQuantity)
            {
                var data = previous is null
                    ? new JsonObject()
                    : JsonNode.Parse(previous.Data.GetRawText())?.AsObject() ?? new JsonObject();
                data["assetId"] = linked.Asset.Id;
                data["roomId"] = context.Room.Id;
                data["templateId"] = context.Configuration.TemplateId;
                data["itemId"] = item.Requirement.Id;
                data["quantity"] = mappedQuantity;
                data["code"] = linked.Asset.Code;
                data["condition"] = linked.Asset.Condition;
                data["trackingMode"] = linked.Metadata.TrackingMode;
                data["unit"] = linked.Metadata.Unit;
                data["source"] = Source;
                data["requestId"] = requestId;
                data["evidenceIds"] = JsonSerializer.SerializeToNode(choice.EvidenceIds, Json);
                data["verifiedBy"] = Actor;
                var write = new SetupDocumentWrite(mappingId, "AssetVerification", "Verified", data, previous?.Version ?? 0);
                mappingWrites.Add(write);
                newMappings.Add(new(context.Room.Id, context.Configuration.TemplateId, item.Requirement.Id,
                    linked.Asset.Id, mappedQuantity, PreviewDocument(location, write, Actor)));
            }
        }

        var total = context.Items.Length;
        var checkedCount = reviewItems.Count(i => i.Checked);
        var state = issues ? "NeedsReview" : checkedCount == total && total > 0 ? "Matched" :
            "PartiallyChecked";
        var desiredWrite = (SetupDocumentWrite?)null;
        var desiredAfter = context.Desired;
        if (mappingWrites.Count > 0 && context.Desired is { } desired && context.Configuration is { } config)
        {
            var complete = context.Items.All(i => progress[i.Requirement.Id] >= i.Requirement.Quantity);
            var status = complete ? "Verified" : progress.Values.Any(v => v > 0) ? "PartiallyVerified" : "PendingVerification";
            if (desired.Status != status)
            {
                desiredWrite = new(desired.Id, desired.Kind, status, config with { Status = status }, desired.Version);
                desiredAfter = PreviewDocument(location, desiredWrite, Actor);
            }
        }
        var updatedMetadata = metadataUpdates.ToDictionary(update => update.AssetId, update => update.Metadata);
        var physicalAfter = context.Physical.Select(p =>
            updatedMetadata.TryGetValue(p.Asset.Id, out var updated) ? p with { Metadata = updated } : p)
            .Concat(newAssets.Select(x => new Physical(x.Asset, x.Metadata))).ToArray();
        var mappingsById = context.Mappings.ToDictionary(mapping => mapping.Document.Id);
        foreach (var mapping in newMappings) mappingsById[mapping.Document.Id] = mapping;
        var mappingsAfter = mappingsById.Values.ToArray();
        var baseline = Baseline(context.Room, true, context.InvalidConfiguration, context.Assignment,
            context.Provenance, context.Template, desiredAfter, physicalAfter, mappingsAfter);
        return new(context, state, issues, reviewItems.ToArray(), physicalAfter,
            mappingWrites.ToArray(), metadataWrites.ToArray(), metadataUpdates.ToArray(), desiredWrite, baseline);
    }

    private static bool SameEvidence(SetupDocument document, Guid[] evidenceIds)
    {
        if (!document.Data.TryGetProperty("evidenceIds", out var saved) || saved.ValueKind != JsonValueKind.Array) return false;
        var existing = saved.EnumerateArray().Select(x => x.GetGuid()).Order().ToArray();
        return existing.SequenceEqual(evidenceIds.Order());
    }

    private static RoomInventoryReviewRoom UpdatedView(PendingRoom pending, SetupDocument saved,
        IReadOnlyDictionary<Guid, SetupDocument> evidence)
    {
        var context = pending.Context;
        var items = pending.Items.Select(item =>
        {
            var docs = item.EvidenceIds.Where(evidence.ContainsKey).Select(id => EvidenceView(evidence[id])).ToArray();
            var requirement = context.Items.Single(i => i.Requirement.Id == item.ItemId).Requirement;
            var pricedPhysical = pending.PhysicalAfter.FirstOrDefault(a =>
                a.Asset.Name == requirement.Name && a.Asset.Category == requirement.Category &&
                a.Asset.RoomId == context.Room.Id);
            return new RoomInventoryReviewItem(item.ItemId,
                requirement.Name, requirement.Category, requirement.Unit, requirement.Quantity,
                item.Checked, docs, requirement.ReferencePrice, pricedPhysical?.Metadata.PurchaseCost);
        }).ToArray();
        var checkedCount = items.Count(i => i.Checked);
        var desired = pending.DesiredWrite is null
            ? context.Desired
            : PreviewDocument(context.Room.LocationId, pending.DesiredWrite, saved.RecordedBy ?? Guid.Empty);
        return new RoomInventoryReviewRoom(context.Room.Id, context.Room.RoomNumber, desired?.Id,
            desired?.Version ?? 0, items, pending.State, checkedCount, items.Length,
            context.Unlinked.Length, pending.Context.InvalidConfiguration ? "desired_inventory_required" :
            context.Unlinked.Length > 0 ? "physical_assets_need_review" :
            pending.HasReviewIssues ? "physical_assets_need_review" : null,
            Hash(new { pending.Baseline, reviewVersion = saved.Version }), saved.RecordedAt);
    }

    public async Task<RoomInventoryReviewView> ConfirmAsync(Guid location, RoomInventoryReviewConfirm input, CancellationToken t)
    {
        Owner();
        if (input is null || input.RequestId == Guid.Empty || !input.Confirmed || input.Rooms is null ||
            input.Rooms.Length is < 1 or > 1000 ||
            input.Rooms.Any(r => r is null || r.RoomId == Guid.Empty || r.DesiredId == Guid.Empty ||
                r.DesiredVersion < 0 || string.IsNullOrWhiteSpace(r.StateToken) || r.StateToken.Length > 128 || r.Items is null ||
                r.Items.Any(i => i is null || i.EvidenceIds is null)) ||
            input.Rooms.Select(r => r.RoomId).Distinct().Count() != input.Rooms.Length)
            throw new PropertyException(400, "invalid_inventory_review");
        var evidenceIds = input.Rooms.SelectMany(r => r.Items).Where(i => i.Checked).SelectMany(i => i.EvidenceIds).ToArray();
        if (evidenceIds.Length > 5000 || evidenceIds.Distinct().Count() != evidenceIds.Length)
            throw new PropertyException(400, "inventory_review_evidence_duplicate_or_limit");
        var actor = Actor;
        var key = CommandKey(location, actor, input.RequestId);
        var fingerprint = Hash(input);
        var totalStarted = Stopwatch.GetTimestamp();
        var newAssetCount = 0;
        var snapshotReads = 3;
        var replayed = false;
        var result = await Store.TransactionAsync(location, async () =>
        {
            // TransactionAsync holds the location advisory lock and rejects an inactive/missing
            // location before invoking this callback; avoid a second location SELECT here.
            var command = await Store.GetAsync(key, CommandKind, t);
            var snapshot = await SnapshotAsync(location, true, evidenceIds, t);
            snapshotReads = 3 + (snapshot.EvidenceRead ? 1 : 0);
            if (command is not null)
            {
                if (command.Data.GetProperty("fingerprint").GetString() != fingerprint)
                    throw new PropertyException(409, "idempotency_payload_mismatch");
                replayed = true;
                return View(snapshot);
            }

            var evidenceSet = evidenceIds.ToHashSet();
            if (evidenceSet.Any(id => !snapshot.Evidence.TryGetValue(id, out var document) || !IsValidEvidence(document, location)))
                throw new PropertyException(400, "inventory_review_evidence_invalid");
            var existingEvidenceOwners = snapshot.Rooms.SelectMany(room =>
            {
                var reviewOwners = room.Prior is null ? [] : Read<ReviewRecord>(room.Prior).Items
                    .SelectMany(item => item.EvidenceIds.Select(id => (Id: id, RoomId: room.Room.Id, ItemId: item.ItemId)));
                var mappingOwners = room.Items.Where(item => item.OwnerAttestation is not null)
                    .SelectMany(item => MappingEvidenceIds(item.OwnerAttestation)
                        .Select(id => (Id: id, RoomId: room.Room.Id, ItemId: item.Requirement.Id)));
                return reviewOwners.Concat(mappingOwners);
            }).GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());

            var selected = new List<(RoomContext Context, RoomInventoryReviewInputItem[] Items)>();
            foreach (var roomInput in input.Rooms)
            {
                var context = snapshot.Rooms.SingleOrDefault(r => r.Room.Id == roomInput.RoomId)
                    ?? throw new PropertyException(404, "resource_not_found");
                var items = ValidateRoom(context, roomInput);
                if (context.Configuration is null) continue; // A room without configured groups stays NotChecked.
                if (context.View.State == "Matched" && items.All(item =>
                    item.Checked && item.EvidenceIds.Length == 0 &&
                    (item.UnitCost is null || context.Items.Single(c => c.Requirement.Id == item.ItemId)
                        .Linked.SingleOrDefault()?.Metadata.PurchaseCost == item.UnitCost))) continue;
                foreach (var item in items.Where(i => i.Checked))
                    foreach (var evidenceId in item.EvidenceIds)
                    {
                        if (existingEvidenceOwners.TryGetValue(evidenceId, out var owner) &&
                            (owner.RoomId != context.Room.Id || owner.ItemId != item.ItemId))
                            throw new PropertyException(409, "inventory_evidence_already_attached");
                    }
                selected.Add((context, items));
            }

            var pending = selected.Select(entry => PrepareRoom(location, entry.Context, entry.Items,
                input.RequestId, snapshot.Evidence, snapshot.AssetMetadataDocuments)).ToArray();
            // A metadata-only price update produces a new Physical record value
            // for an existing Asset. Compare identity, not record equality, or a
            // priced existing Asset gets inserted a second time.
            var newAssets = pending.SelectMany(p => p.PhysicalAfter
                .Where(x => !p.Context.Physical.Any(existing => existing.Asset.Id == x.Asset.Id))
                .Select(x => new AssetInventoryCreation(x.Asset, x.Metadata, "Owner confirmed configured asset group")))
                .DistinctBy(x => x.Asset.Id).ToArray();
            newAssetCount = newAssets.Length;
            await Store.SaveInventoryAssetsAsync(location, newAssets, actor, t);
            foreach (var update in pending.SelectMany(room => room.MetadataUpdates))
                await Store.SaveAssetMetadataAsync(update.AssetId, update.Metadata, t);

            var writes = new List<SetupDocumentWrite>();
            writes.AddRange(pending.SelectMany(p => p.MappingWrites));
            writes.AddRange(pending.SelectMany(p => p.MetadataWrites));
            writes.AddRange(pending.Where(p => p.DesiredWrite is not null).Select(p => p.DesiredWrite!));
            foreach (var review in pending)
            {
                var record = new ReviewRecord(review.Context.Room.Id,
                    review.DesiredWrite is null ? review.Context.Desired?.Id : review.DesiredWrite.Id,
                    review.DesiredWrite is null ? review.Context.Desired?.Version ?? 0 : review.DesiredWrite.ExpectedVersion + 1,
                    review.Baseline, review.State, input.RequestId, review.Items,
                    review.Context.Unlinked.Select(a => a.Asset.Id).ToArray());
                writes.Add(new(ReviewKey(review.Context.Room.Id), ReviewKind, review.State, record,
                    review.Context.Prior?.Version ?? 0));
            }
            writes.Add(new(key, CommandKind, "Completed", new { fingerprint, input.RequestId }, 0));
            var saved = await Store.SaveBatchAsync(location, writes, actor, t);
            var savedReviews = saved.Where(d => d.Kind == ReviewKind).ToDictionary(d => d.Id);
            var updated = snapshot.Rooms.ToDictionary(r => r.Room.Id, r => r.View);
            foreach (var review in pending)
            {
                var document = savedReviews[ReviewKey(review.Context.Room.Id)];
                updated[review.Context.Room.Id] = UpdatedView(review, document, snapshot.Evidence);
            }
            return new RoomInventoryReviewView(snapshot.Rooms.Select(r => updated[r.Room.Id]).ToArray());
        }, t);
        var knownRoundTrips = 4 /* transaction begin, advisory lock, active-location guard, commit */ + 1 /* idempotency lookup */ +
            snapshotReads + (newAssetCount == 0 ? 0 : 2 /* duplicate-code check + EF asset/metadata/audit save */) +
            (replayed ? 0 : 1) /* batch document/history write */;
        logger.LogInformation("Room inventory confirm: rooms={RoomCount}, checkedGroups={CheckedGroups}, evidence={EvidenceCount}, newAssets={NewAssetCount}, knownDatabaseRoundTrips={DatabaseRoundTrips}, elapsedMs={ElapsedMs:F1}; writes are batched",
            input.Rooms.Length, input.Rooms.SelectMany(r => r.Items).Count(i => i.Checked),
            evidenceIds.Length, newAssetCount, knownRoundTrips, Stopwatch.GetElapsedTime(totalStarted).TotalMilliseconds);
        return result;
    }
}
