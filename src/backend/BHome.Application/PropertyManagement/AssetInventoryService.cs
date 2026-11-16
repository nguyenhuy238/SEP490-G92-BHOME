using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BHome.Application.PropertyManagement;

public sealed class AssetInventoryService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access) : SetupWorkspaceService(store, user, access)
{
    public static bool IsLocationDefault(SetupDocument document) =>
        document.Status == "Published" && !Read<AssetTemplateWrite>(document).Scoped;

    private static AssetTemplateItem[] ValidateItems(AssetTemplateItem[] items, bool allowEmpty = false)
    {
        if (items is null || items.Length > 100 || !allowEmpty && items.Length == 0 ||
            items.Any(i => i is null) || items.Select(i => i.Id).Distinct().Count() != items.Length)
            throw new PropertyException(400, "invalid_template_items");
        return items.Select(item =>
        {
            if (item.Id == Guid.Empty || item.Quantity is < 1 or > 10000 ||
                item.TrackingMode is not ("Serialized" or "BulkQuantity"))
                throw new PropertyException(400, "invalid_template_item");
            return item with
            {
                Name = Text(item.Name, 150),
                Category = Text(item.Category, 80),
                Unit = string.IsNullOrWhiteSpace(item.Unit) ? null : Text(item.Unit, 80)
            };
        }).ToArray();
    }

    public Task<SetupDocument> SaveTemplateAsync(Guid? id, AssetTemplateWrite input, CancellationToken t)
    {
        Owner(); Text(input.Name, 150);
        input = input with { Items = ValidateItems(input.Items) };
        if (input.ScopeRoomId is not null) throw new PropertyException(400, "template_scope_invalid");
        return Store.TransactionAsync(input.LocationId, async () =>
        {
            if (id is { } existing && (await Document(existing, "AssetTemplate", true, t)).Status != "Draft") throw new PropertyException(409, "published_template_immutable");
            return await Store.SaveAsync(id ?? Guid.NewGuid(), input.LocationId, "AssetTemplate", "Draft", input, input.ExpectedVersion, Actor, t);
        }, t);
    }
    public async Task<AssetSyncRun> PublishAsync(Guid id, int expectedVersion, CancellationToken t)
    {
        var initial = await Document(id, "AssetTemplate", true, t);
        var published = await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, "AssetTemplate", true, t);
            if (doc.Status == "Draft") doc = await Store.SaveAsync(id, doc.LocationId, doc.Kind, "Published", Read<AssetTemplateWrite>(doc), expectedVersion, Actor, t);
            else if (doc.Status != "Published" || doc.Version != expectedVersion && doc.Version != expectedVersion + 1) throw new PropertyException(409, "stale_version");
            return doc;
        }, t);
        return await Sync(published, t);
    }
    public async Task<AssetSyncRun> SyncAsync(Guid id, CancellationToken t)
    {
        var doc = await Document(id, "AssetTemplate", true, t);
        if (doc.Status != "Published") throw new PropertyException(409, "published_template_required");
        return await Sync(doc, t);
    }
    private async Task<AssetSyncRun> Sync(SetupDocument doc, CancellationToken t, Guid? onlyRoom = null)
    {
        var input = Read<AssetTemplateWrite>(doc); var results = new List<AssetSyncRoom>();
        foreach (var room in await Store.RoomsAsync(doc.LocationId, t))
        {
            if (onlyRoom is not null && room != onlyRoom) continue;
            try
            {
                var status = await Store.TransactionAsync(doc.LocationId, async () =>
                {
                    var assignment = await Store.GetAsync(Key($"asset-template-assignment:{room}"), "AssetTemplateAssignment", t);
                    var selected = assignment is null ? null : Read<AssetTemplateAssignment>(assignment).TemplateId;
                    // Legacy rooms retain their explicit location-wide default. Configured rooms
                    // must not inherit a different room configuration's most recent template.
                    if (selected is null && assignment?.Status != "None" && await Store.GetAsync(LocationSetupKeys.RoomProvenance(room), "RoomProvenance", t) is null)
                        selected = (await Store.ListAsync(doc.LocationId, "AssetTemplate", t)).Where(IsLocationDefault).OrderByDescending(d => d.RecordedAt).ThenBy(d => d.Id).FirstOrDefault()?.Id;
                    if (selected != doc.Id) return "SkippedOtherTemplate";
                    if (!await Store.EligibleRoomAsync(room, t)) return "SkippedNotEligible";
                    var desiredId = Key($"desired:{room}:{doc.Id}:{doc.Version}");
                    if (await Store.GetAsync(desiredId, "DesiredAssets", t) is null)
                        await Store.SaveAsync(desiredId, doc.LocationId, "DesiredAssets", "PendingVerification",
                        new DesiredAssets(doc.Id, doc.Version, room, input.Items, "PendingVerification"), 0, Actor, t);
                    return "Applied";
                }, t);
                results.Add(new(room, status));
            }
            catch (PropertyException e) { results.Add(new(room, "Failed:" + e.Code)); }
        }
        var runId = Key($"sync:{doc.Id}:{doc.Version}");
        var run = new AssetSyncRun(doc.Id, doc.Version, results, runId);
        await Store.TransactionAsync(doc.LocationId, async () =>
        {
            var old = await Store.GetAsync(runId, "AssetSyncRun", t);
            return await Store.SaveAsync(runId, doc.LocationId, "AssetSyncRun", results.Any(r => r.Status.StartsWith("Failed:", StringComparison.Ordinal)) ? "PartialFailure" : "Completed", run, old?.Version ?? 0, Actor, t);
        }, t);
        return run;
    }
    public async Task<IReadOnlyList<AssetHistoryEntry>> HistoryAsync(Guid id, CancellationToken t)
    {
        var asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
        await Scope(asset.LocationId, false, t); return await Store.AssetHistoryAsync(id, t);
    }
    public async Task<AssetInventory> InventoryAsync(Guid room, CancellationToken t)
    {
        var location = await RoomScope(room, false, t);
        var assets = await Store.AssetsAsync(room, t); var metadata = await Store.AssetMetadataAsync(assets.Select(a => a.Id).ToArray(), t);
        if (!User.IsInRole(BHome.Domain.IdentityAccess.Roles.Owner)) metadata = metadata.ToDictionary(p => p.Key, p => p.Value with { PurchaseCost = null });
        var templates = (await Store.ListAsync(location, "AssetTemplate", t)).ToDictionary(d => d.Id);
        var assignment = await Store.GetAsync(Key($"asset-template-assignment:{room}"), "AssetTemplateAssignment", t);
        var selected = assignment is null ? null : Read<AssetTemplateAssignment>(assignment).TemplateId;
        var effectiveTemplate = selected;
        if (effectiveTemplate is null && assignment?.Status != "None" && await Store.GetAsync(LocationSetupKeys.RoomProvenance(room), "RoomProvenance", t) is null)
            effectiveTemplate = templates.Values.Where(IsLocationDefault).OrderByDescending(d => d.RecordedAt).ThenBy(d => d.Id).FirstOrDefault()?.Id;
        var desired = (await Store.ListAsync(location, "DesiredAssets", t)).Where(d => Read<DesiredAssets>(d).RoomId == room)
            .OrderByDescending(d => Read<DesiredAssets>(d).TemplateId == effectiveTemplate).ThenByDescending(d => templates.GetValueOrDefault(Read<DesiredAssets>(d).TemplateId)?.RecordedAt).ThenBy(d => d.Id).ToArray();
        // Retain historical desired inventories, but never verify against an unassigned or superseded template.
        var current = effectiveTemplate is { } effectiveId && templates.TryGetValue(effectiveId, out var effective) && effective.Status == "Published"
            ? desired.FirstOrDefault(d => Read<DesiredAssets>(d).TemplateId == effectiveId && Read<DesiredAssets>(d).TemplateVersion == effective.Version)
            : null;
        var discrepancies = new List<AssetDiscrepancy>();
        var progress = new List<AssetRequirementProgress>();
        if (current is not null)
        {
            var target = Read<DesiredAssets>(current); var verifications = await Store.ListAsync(location, "AssetVerification", t);
            var activeAssetIds = assets.Where(a => a.Status != AssetStatus.Retired).Select(a => a.Id).ToHashSet();
            foreach (var item in target.Items)
            {
                var verified = verifications.Where(v => v.Data.GetProperty("roomId").GetGuid() == room &&
                    v.Data.GetProperty("templateId").GetGuid() == target.TemplateId &&
                    v.Data.GetProperty("itemId").GetGuid() == item.Id && activeAssetIds.Contains(v.Data.GetProperty("assetId").GetGuid()))
                    .GroupBy(v => v.Data.GetProperty("assetId").GetGuid())
                    .Sum(g => Math.Min(g.Max(v => v.Data.GetProperty("quantity").GetInt32()), metadata.GetValueOrDefault(g.Key)?.Quantity ?? 0));
                progress.Add(new(item.Id, verified));
            }
            foreach (var asset in assets.Where(a => a.Status != AssetStatus.Retired))
            {
                var mappings = verifications.Where(v => v.Data.GetProperty("assetId").GetGuid() == asset.Id).ToArray();
                if (mappings.Length == 0) discrepancies.Add(new(asset.Id, "UnmappedPhysicalAsset"));
                else if (!mappings.Any(v => target.Items.Any(i => i.Id == v.Data.GetProperty("itemId").GetGuid()))) discrepancies.Add(new(asset.Id, "PendingRemovalReview"));
            }
        }
        return new(assets, desired, metadata, current?.Id, discrepancies, assignment?.Version ?? 0, selected, progress);
    }
    public async Task<Guid> VerifyAsync(Guid room, AssetVerification input, CancellationToken t)
    {
        var location = await RoomScope(room, false, t); Text(input.Code, 80); Text(input.Condition, 1000); await Evidence(location, input.EvidenceObjectKey, t);
        return await Store.TransactionAsync(location, async () =>
        {
            var template = await Document(input.TemplateId, "AssetTemplate", false, t);
            if (template.LocationId != location || template.Status != "Published") throw new PropertyException(400, "template_scope_invalid");
            var desired = await Store.GetAsync(Key($"desired:{room}:{template.Id}:{template.Version}"), "DesiredAssets", t) ?? throw new PropertyException(409, "desired_inventory_required");
            var item = Read<DesiredAssets>(desired).Items.SingleOrDefault(i => i.Id == input.ItemId) ?? throw new PropertyException(400, "template_item_not_found");
            var id = Key($"verified:{room}:{template.Id}:{input.ItemId}:{input.Code.Trim().ToUpperInvariant()}");
            var prior = await Store.GetAsync(id, "AssetVerification", t);
            var fingerprint = Hash(input);
            if (prior is not null && prior.Data.TryGetProperty("fingerprint", out var priorFingerprint) &&
                priorFingerprint.GetString() == fingerprint)
                return prior.Data.GetProperty("assetId").GetGuid();

            var verifications = await Store.ListAsync(location, "AssetVerification", t);
            var attestedGroups = verifications.Where(v => v.Data.GetProperty("roomId").GetGuid() == room &&
                v.Data.GetProperty("itemId").GetGuid() == item.Id && v.Data.TryGetProperty("source", out var source) &&
                source.GetString() == "OwnerAttestation");
            var activeAttestations = new List<(SetupDocument Document, Asset Asset)>();
            foreach (var attestation in attestedGroups)
            {
                var grouped = await Store.AssetAsync(attestation.Data.GetProperty("assetId").GetGuid(), t);
                if (grouped is not null && grouped.Status != AssetStatus.Retired)
                    activeAttestations.Add((attestation, grouped));
            }
            if (activeAttestations.Count > 0)
            {
                if ((await InventoryAsync(room, t)).CurrentDesiredId != desired.Id)
                    throw new PropertyException(409, "desired_template_changed");
                if (desired.Version != input.ExpectedVersion || input.Quantity < 1)
                    throw new PropertyException(409, "invalid_verification_quantity_or_version");
                if (activeAttestations.Count != 1 || activeAttestations[0].Document.Data.GetProperty("templateId").GetGuid() != template.Id)
                    throw new PropertyException(409, "asset_group_already_attested");

                var (ownerAttestation, groupedAsset) = activeAttestations[0];
                var attestedMetadata = (await Store.AssetMetadataAsync([groupedAsset.Id], t)).GetValueOrDefault(groupedAsset.Id)
                    ?? throw new PropertyException(409, "asset_metadata_missing");
                if (groupedAsset.LocationId != location || groupedAsset.RoomId != room ||
                    groupedAsset.Status == AssetStatus.Retired ||
                    !string.Equals(groupedAsset.Name, item.Name, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(groupedAsset.Category, item.Category, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(groupedAsset.Code, input.Code.Trim(), StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(groupedAsset.Condition, input.Condition.Trim(), StringComparison.Ordinal) ||
                    attestedMetadata.Quantity != input.Quantity || input.Quantity != item.Quantity ||
                    attestedMetadata.Unit is not null && item.Unit is not null &&
                    !string.Equals(attestedMetadata.Unit, item.Unit, StringComparison.OrdinalIgnoreCase) ||
                    input.ExistingAssetId is { } requestedAssetId && requestedAssetId != groupedAsset.Id ||
                    ownerAttestation.Data.GetProperty("quantity").GetInt32() != attestedMetadata.Quantity)
                    throw new PropertyException(409, "owner_attested_asset_mismatch");

                var evidenceId = await Store.EvidenceIdAsync(location, input.EvidenceObjectKey, t)
                    ?? throw new PropertyException(400, "verified_private_evidence_required");
                var attestationData = JsonNode.Parse(ownerAttestation.Data.GetRawText())?.AsObject()
                    ?? throw new PropertyException(409, "invalid_setup_document");
                var fingerprints = attestationData["staffEvidenceFingerprints"] as JsonArray ?? new JsonArray();
                if (fingerprints.Any(value => string.Equals(value?.GetValue<string>(), fingerprint, StringComparison.Ordinal)))
                    return groupedAsset.Id;

                var evidenceIds = attestationData["staffEvidenceIds"] as JsonArray ?? new JsonArray();
                if (!evidenceIds.Any(value => Guid.TryParse(value?.GetValue<string>(), out var id) && id == evidenceId))
                    evidenceIds.Add(evidenceId);
                fingerprints.Add(fingerprint);
                var evidenceEntries = attestationData["staffEvidenceEntries"] as JsonArray ?? new JsonArray();
                evidenceEntries.Add(JsonSerializer.SerializeToNode(new
                {
                    evidenceId,
                    verifiedBy = Actor,
                    fingerprint
                }, Json));
                attestationData["staffEvidenceIds"] = evidenceIds;
                attestationData["staffEvidenceFingerprints"] = fingerprints;
                attestationData["staffEvidenceEntries"] = evidenceEntries;
                await Store.SaveAsync(ownerAttestation.Id, location, "AssetVerification", "Verified",
                    attestationData, ownerAttestation.Version, Actor, t);
                return groupedAsset.Id;
            }
            if (prior is not null)
                throw new PropertyException(409, "verification_conflict");
            if ((await InventoryAsync(room, t)).CurrentDesiredId != desired.Id)
                throw new PropertyException(409, "desired_template_changed");
            if (desired.Version != input.ExpectedVersion || input.Quantity < 1)
                throw new PropertyException(409, "invalid_verification_quantity_or_version");
            if (item.TrackingMode == "Serialized" && input.Quantity != 1)
                throw new PropertyException(409, "invalid_verification_quantity_or_version");
            var verified = verifications.Where(v => v.Data.GetProperty("roomId").GetGuid() == room &&
                v.Data.GetProperty("templateId").GetGuid() == template.Id && v.Data.GetProperty("itemId").GetGuid() == item.Id)
                .Sum(v => v.Data.GetProperty("quantity").GetInt32());
            if (verified + input.Quantity > item.Quantity) throw new PropertyException(409, "desired_quantity_exceeded");
            var asset = input.ExistingAssetId is { } existing ? await Store.AssetAsync(existing, t) ?? throw new PropertyException(404, "asset_not_found") :
                new Asset { LocationId = location, RoomId = room, Code = input.Code.Trim(), Name = item.Name, Category = item.Category, Condition = input.Condition.Trim() };
            if (input.ExistingAssetId is not null)
            {
                var existingMetadata = (await Store.AssetMetadataAsync([asset.Id], t))[asset.Id];
                if (asset.LocationId != location || asset.RoomId != room || asset.Status == AssetStatus.Retired || !string.Equals(asset.Code, input.Code.Trim(), StringComparison.OrdinalIgnoreCase) ||
                    asset.Condition != input.Condition.Trim() || existingMetadata.Quantity != input.Quantity ||
                    (input.Quantity != 1 && existingMetadata.TrackingMode != item.TrackingMode) ||
                    (existingMetadata.Unit is not null && item.Unit is not null && !string.Equals(existingMetadata.Unit, item.Unit, StringComparison.OrdinalIgnoreCase)))
                    throw new PropertyException(409, "existing_asset_verification_mismatch");
                if (verifications.Any(v => v.Data.GetProperty("roomId").GetGuid() == room &&
                    v.Data.GetProperty("templateId").GetGuid() == template.Id && v.Data.GetProperty("assetId").GetGuid() == asset.Id))
                    throw new PropertyException(409, "asset_already_verified");
            }
            await Store.SaveAssetAsync(asset, Actor, "Physical inventory verified", t);
            if (input.ExistingAssetId is null) await Store.SaveAssetMetadataAsync(asset.Id, new(item.TrackingMode, input.Quantity, null, null, null, item.Unit), t);
            await Store.SaveAsync(id, location, "AssetVerification", "Verified", new
            {
                assetId = asset.Id,
                roomId = room,
                templateId = template.Id,
                itemId = item.Id,
                input.Quantity,
                input.Code,
                input.Condition,
                trackingMode = item.TrackingMode,
                unit = item.Unit,
                input.EvidenceObjectKey,
                fingerprint = Hash(input),
                verifiedBy = Actor
            }, 0, Actor, t);
            var all = await Store.ListAsync(location, "AssetVerification", t);
            var data = Read<DesiredAssets>(desired);
            var physical = await Store.AssetsAsync(room, t);
            var metadata = await Store.AssetMetadataAsync(physical.Where(a => a.Status != AssetStatus.Retired).Select(a => a.Id).ToArray(), t);
            var complete = data.Items.All(i => all.Where(v => v.Data.GetProperty("roomId").GetGuid() == room && v.Data.GetProperty("templateId").GetGuid() == template.Id &&
                v.Data.GetProperty("itemId").GetGuid() == i.Id).GroupBy(v => v.Data.GetProperty("assetId").GetGuid())
                .Sum(g => Math.Min(g.Max(v => v.Data.GetProperty("quantity").GetInt32()), metadata.GetValueOrDefault(g.Key)?.Quantity ?? 0)) == i.Quantity);
            await Store.SaveAsync(desired.Id, location, desired.Kind, complete ? "Verified" : "PartiallyVerified",
                data with { Status = complete ? "Verified" : "PartiallyVerified" }, desired.Version, Actor, t);
            return asset.Id;
        }, t);
    }
    public async Task<SetupDocument> CloneTemplateAsync(Guid id, CancellationToken t)
    {
        var source = await Document(id, "AssetTemplate", true, t);
        if (Read<AssetTemplateWrite>(source).ScopeRoomId is not null) throw new PropertyException(409, "room_specific_template");
        return await SaveTemplateAsync(null, Read<AssetTemplateWrite>(source) with { ExpectedVersion = 0 }, t);
    }

    // Called within the Location transaction. A revision is an independent immutable
    // requirements snapshot; it never creates or changes verified physical Assets.
    internal async Task<SetupDocument?> CreateRequirementsAsync(Guid location, string name, AssetTemplateItem[] items,
        Guid? roomId, CancellationToken t)
    {
        Owner();
        items = ValidateItems(items, allowEmpty: true);
        if (items.Length == 0) return null;
        return await Store.SaveAsync(Guid.NewGuid(), location, "AssetTemplate", "Published",
            new AssetTemplateWrite(location, Text(name, 150), items, Scoped: true, ScopeRoomId: roomId), 0, Actor, t);
    }

    internal async Task AssignRequirementsAsync(Guid location, Guid room, SetupDocument? template, int expectedVersion,
        CancellationToken t)
    {
        Owner();
        if (await Store.RoomLocationAsync(room, t) != location) throw new PropertyException(404, "resource_not_found");
        if (await Store.RoomConfigurationLockReasonAsync(room, t) is { } reason) throw new PropertyException(409, reason);
        var assignment = new AssetTemplateAssignment(template?.Id, expectedVersion);
        await Store.SaveAsync(Key($"asset-template-assignment:{room}"), location, "AssetTemplateAssignment",
            template is null ? "None" : "Assigned", assignment, expectedVersion, Actor, t);
        if (template is not null)
        {
            var data = Read<AssetTemplateWrite>(template);
            if (template.LocationId != location || template.Status != "Published" ||
                data.ScopeRoomId is { } scopedRoom && scopedRoom != room)
                throw new PropertyException(400, "template_scope_invalid");
            var desiredId = Key($"desired:{room}:{template.Id}:{template.Version}");
            if (await Store.GetAsync(desiredId, "DesiredAssets", t) is null)
                await Store.SaveAsync(desiredId, location, "DesiredAssets", "PendingVerification",
                    new DesiredAssets(template.Id, template.Version, room, data.Items, "PendingVerification"), 0, Actor, t);
        }
    }

    public async Task<SetupDocument> AssignTemplateAsync(Guid room, AssetTemplateAssignment input, CancellationToken t)
    {
        var location = await RoomScope(room, true, t);
        return await Store.TransactionAsync(location, async () =>
        {
            if (await Store.RoomConfigurationLockReasonAsync(room, t) is { } reason) throw new PropertyException(409, reason);
            SetupDocument? template = null;
            if (input.TemplateId is { } id)
            {
                template = await Document(id, "AssetTemplate", true, t);
                if (template.LocationId != location || template.Status != "Published" ||
                    Read<AssetTemplateWrite>(template).ScopeRoomId is { } scopedRoom && scopedRoom != room)
                    throw new PropertyException(400, "template_scope_invalid");
            }
            var doc = await Store.SaveAsync(Key($"asset-template-assignment:{room}"), location, "AssetTemplateAssignment", input.TemplateId is null ? "Default" : "Assigned", input, input.ExpectedVersion, Actor, t);
            if (template is null && await Store.GetAsync(LocationSetupKeys.RoomProvenance(room), "RoomProvenance", t) is null)
                template = (await Store.ListAsync(location, "AssetTemplate", t)).Where(IsLocationDefault).OrderByDescending(d => d.RecordedAt).ThenBy(d => d.Id).FirstOrDefault();
            if (template is not null) await Sync(template, t, room);
            return doc;
        }, t);
    }
    public async Task<SetupDocument> MetadataAsync(Guid id, AssetMetadataWrite input, CancellationToken t)
    {
        Owner(); var asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found"); Text(input.Reason, 500);
        var m = input.Metadata;
        if (m is null) throw new PropertyException(400, "invalid_asset_metadata");
        if (m.TrackingMode is not ("Serialized" or "BulkQuantity") || m.Quantity < 1 || m.TrackingMode == "Serialized" && m.Quantity != 1 ||
            m.PurchaseCost < 0 || m.UsefulLifeMonths < 1) throw new PropertyException(400, "invalid_asset_metadata");
        return await Store.TransactionAsync(asset.LocationId, async () =>
        {
            asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
            var previous = (await Store.AssetMetadataAsync([id], t))[id];
            m = m with { Unit = string.IsNullOrWhiteSpace(m.Unit) ? previous.Unit : Text(m.Unit, 80) };
            if ((m.Quantity != previous.Quantity || m.TrackingMode != previous.TrackingMode) &&
                (asset.Status is AssetStatus.Retired or AssetStatus.UnderRepair || await Store.HasOpenAssetWorkAsync(id, t)))
                throw new PropertyException(409, "asset_workflow_controlled");
            await Store.SaveAssetMetadataAsync(id, m, t);
            asset.Version++; await Store.SaveAssetAsync(asset, Actor, input.Reason, t);
            return await Store.SaveAsync(id, asset.LocationId, "AssetMetadata", "Recorded", new { m.TrackingMode, m.Quantity, m.PurchaseCost, m.PurchaseDate, m.UsefulLifeMonths, m.Unit, input.Reason }, input.ExpectedVersion, Actor, t);
        }, t);
    }
    public async Task<SetupDocument> ReadMetadataAsync(Guid id, CancellationToken t)
    {
        Owner(); var asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
        return await Store.GetAsync(id, "AssetMetadata", t) ?? new SetupDocument(id, asset.LocationId, "AssetMetadata", "Recorded", 0,
            System.Text.Json.JsonSerializer.SerializeToElement((await Store.AssetMetadataAsync([id], t))[id], Json));
    }
    public async Task<Guid> ReplaceAsync(Guid id, AssetReplacement input, CancellationToken t)
    {
        Owner(); var asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
        Text(input.Code, 80); Text(input.Condition, 1000); Text(input.Reason, 500);
        return await Store.TransactionAsync(asset.LocationId, async () =>
        {
            asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
            if (asset.Version != input.ExpectedVersion || asset.Status is AssetStatus.UnderRepair or AssetStatus.Retired ||
                await Store.HasOpenAssetWorkAsync(id, t))
                throw new PropertyException(409, "asset_workflow_controlled");
            asset.Status = AssetStatus.Retired; asset.Version++; await Store.SaveAssetAsync(asset, Actor, input.Reason, t);
            var next = new Asset
            {
                LocationId = asset.LocationId,
                RoomId = asset.RoomId,
                CommonArea = asset.CommonArea,
                Name = asset.Name,
                Category = asset.Category,
                Code = input.Code.Trim(),
                Condition = input.Condition.Trim()
            };
            await Store.SaveAssetAsync(next, Actor, input.Reason, t);
            var metadata = (await Store.AssetMetadataAsync([id], t))[id];
            await Store.SaveAssetMetadataAsync(next.Id, metadata with { PurchaseCost = null, PurchaseDate = null, UsefulLifeMonths = null }, t);
            await Store.SaveAsync(next.Id, asset.LocationId, "AssetReplacement", "Recorded", new { previousAssetId = id, replacementAssetId = next.Id, input.Reason }, 0, Actor, t);
            return next.Id;
        }, t);
    }
}
