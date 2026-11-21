using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
namespace BHome.Application.Contracts;
public sealed partial class ContractService
{
    private static bool HasQuantityBaseline(ContractHandover? h)
    {
        if (h is null) return false;
        var snapshot = Snapshot(h);
        return snapshot.Assets.Length == 0 ? snapshot.NoAssetsConfirmed : snapshot.Assets.All(a => a.HandedOverQuantity is not null);
    }
    private async Task<(Contract Contract, ContractHandover? Handover)> Baseline(Contract c, CancellationToken t)
    {
        var seen = new HashSet<Guid>(); var room = c.RoomId; var tenant = c.TenantUserId;
        while (seen.Add(c.Id))
        {
            if (c.RoomId != room || c.TenantUserId != tenant) throw ContractException.Conflict("contract_version_integrity_failed");
            var handover = await Handovers.GetAsync(c.Id, t);
            if (handover?.Status == ContractHandoverStatus.Confirmed) return (c, handover);
            if (c.PreviousContractId is not { } previous) return (c, null);
            c = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        }
        throw ContractException.Conflict("contract_version_integrity_failed");
    }
    private async Task<string?> LegacyException(Contract c, CancellationToken t)
    {
        if (contractSetup is null) return null;
        var doc = await HandoverSetup.GetAsync(HandoverKey($"legacy-handover-exception:{c.Id:N}"), "LegacyHandoverException", t);
        return doc?.Data.GetProperty("reason").GetString();
    }
    public Task<ContractId> ApproveLegacyHandoverAsync(Guid id, LegacyHandoverException x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        HandoverActive(c);
        if (await Replay(key, "legacy-handover", new { id, x }, t) is { } replay) return new ContractId(replay);
        var baseline = (await Baseline(c, t)).Handover;
        if (HasQuantityBaseline(baseline)) throw ContractException.Conflict("handover_baseline_exists");
        var docId = HandoverKey($"legacy-handover-exception:{id:N}");
        var prior = await HandoverSetup.GetAsync(docId, "LegacyHandoverException", t);
        if (prior is not null) throw ContractException.Conflict("legacy_handover_exception_already_recorded");
        await HandoverSetup.SaveAsync(docId, c.Room.LocationId, "LegacyHandoverException", "Approved", new { contractId = id, reason = HandoverText(x.Reason, 2000) }, 0, Actor, t);
        Audit("ContractLegacyHandoverExceptionApproved", id); Remember(key, "legacy-handover", new { id, x }, docId); return new ContractId(docId);
    }, t);
    private static HandoverAsset[] InspectionGroups(HandoverSnapshot? baseline, HandoverInventory inventory)
    {
        var physical = inventory.Groups.SelectMany(a => a.PhysicalAssets ?? []).DistinctBy(p => p.Id).ToDictionary(p => p.Id);
        var groups = (baseline?.Assets ?? []).Select(a => a with
        {
            ConfiguredQuantity = a.HandedOverQuantity,
            InventoryCondition = a.ObservedCondition,
            ObservedCondition = "",
            PhysicalAssets = (a.PhysicalAssets ?? (physical.TryGetValue(a.Id, out var legacyAsset) ? [legacyAsset] : [])).Select(p => physical.GetValueOrDefault(p.Id) ?? p).ToArray()
        }).ToList();
        var used = groups.SelectMany(a => a.PhysicalAssets ?? []).Select(p => p.Id).ToHashSet();
        groups.AddRange(inventory.Groups.Where(a => !groups.Any(g => g.Id == a.Id) &&
            (!(a.PhysicalAssets ?? []).Any() || a.PhysicalAssets!.Any(p => !used.Contains(p.Id))))
            .Select(a => a with { ConfiguredQuantity = null, HandedOverQuantity = baseline is null ? null : 0 }));
        return groups.ToArray();
    }
    public async Task<InspectionPreparation> InspectionPreparationAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff], t); var (root, h) = await Baseline(c, t);
        var baseline = h is null ? null : await EffectiveBaseline(c, Snapshot(h), t);
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(c.RoomId, t);
        return new(h is null ? null : HandoverView(h) with { Snapshot = baseline! }, h is null ? null : root.Id,
            await repository.FinalReadingsAsync(id, c.RoomId, Today, t), await repository.HasOtherActiveContractsAsync(c.RoomId, id, t),
            inventory, inventory is null ? baseline?.Assets : InspectionGroups(baseline, inventory), await LegacyException(c, t),
            handoverInventory is null ? h is null : !HasQuantityBaseline(h));
    }
    private async Task RecordFinalInspection(Contract c, ContractMoveOut m, InspectionInput x, CancellationToken t)
    {
        var (root, h) = await Baseline(c, t);
        var missingQuantities = handoverInventory is null ? h is null : !HasQuantityBaseline(h);
        var legacy = missingQuantities ? await LegacyException(c, t) : null;
        if (missingQuantities && legacy is null)
        {
            if (handoverInventory is not null) throw ContractException.Conflict("owner_legacy_handover_exception_required");
            m.PendingReason = "confirmed_handover_baseline_required"; return;
        }
        if (x.Assets is null || x.RoomCondition is null || x.KeysAndAccess is null) throw ContractException.Invalid("inspection_checklist_required");
        var baseline = h is null ? null : await EffectiveBaseline(c, Snapshot(h), t);
        // New signed Move-In baselines have the seven canonical room checks and
        // a counted RoomKey bundle. The complete Move-Out must inspect the same
        // four modules, while old contracts without those structured fields
        // retain their historical read/submit compatibility.
        var requireRoomChecks = baseline?.RoomChecks is { Length: > 0 };
        var requireAccess = baseline?.AccessItems is { Length: > 0 };
        if (requireRoomChecks && x.RoomChecks is null ||
            requireAccess && x.AccessItems is null)
            throw ContractException.Invalid("move_out_four_sections_required");
        var roomChecks = HandoverRoomChecklist.Merge(null, x.RoomChecks);
        var accessItems = HandoverRoomChecklist.NormalizeAccess(x.AccessItems);
        if (x.RoomChecks is not null &&
            HandoverRoomChecklist.Missing(roomChecks, accessItems.Length > 0 ? accessItems : baseline?.AccessItems, null)
                .Any(code => code is "room_checklist" or "room_issue_evidence"))
            throw ContractException.Invalid("move_out_room_checklist_incomplete");
        if (requireAccess && accessItems.Length == 0)
            throw ContractException.Invalid("move_out_access_checklist_required");
        var keyEvidence = x.KeyEvidenceIds ?? [];
        if (keyEvidence.Length > 5 || keyEvidence.Contains(Guid.Empty) ||
            keyEvidence.Distinct().Count() != keyEvidence.Length)
            throw ContractException.Invalid("invalid_move_out_key_evidence");
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(c.RoomId, t);
        if (inventory is not null && inventory.StateToken != x.InventoryToken) throw ContractException.Conflict("handover_asset_inventory_changed");
        if (inventory is { Groups.Length: 0, NoAssetsConfirmed: false }) throw ContractException.Conflict("owner_no_assets_confirmation_required");
        var groups = inventory is null ? baseline!.Assets : InspectionGroups(baseline, inventory);
        var inspected = HandoverChecklist.Inspect(groups, x.Assets, inventory is not null, !missingQuantities);
        HandoverChecklist.RequireSeparateEvidence(x.EvidenceIds, inspected);
        if (inspected.Any(a => !a.Checked)) throw ContractException.Invalid("handover_checklist_incomplete");
        HandoverRoomChecklist.RequireSeparateKeyEvidence(keyEvidence, x.EvidenceIds, roomChecks, x.Assets);
        var roomEvidence = roomChecks.SelectMany(check => check.EvidenceIds).ToArray();
        if (roomEvidence.Distinct().Count() != roomEvidence.Length ||
            roomEvidence.Intersect(x.EvidenceIds).Any() ||
            roomEvidence.Intersect(inspected.SelectMany(asset => asset.EvidenceIds ?? [])).Any())
            throw ContractException.Invalid("move_out_room_evidence_must_be_separate");
        if (accessItems is { Length: 1 } &&
            baseline?.AccessItems?.SingleOrDefault(a => a.Type == "RoomKey") is { } receivedKeys &&
            accessItems[0].Quantity < receivedKeys.Quantity &&
            (keyEvidence.Length == 0 || string.IsNullOrWhiteSpace(accessItems[0].Notes)))
            throw ContractException.Invalid("move_out_missing_keys_evidence_required");
        var readings = await repository.FinalReadingsAsync(c.Id, c.RoomId, Today, t);
        var electricity = readings.Single(r => r.Id == x.ElectricityReadingId); var water = readings.Single(r => r.Id == x.WaterReadingId);
        foreach (var r in new[] { electricity, water }) { using var bytes = new MemoryStream(); await storage.CopyToAsync(r.EvidenceObjectKey, bytes, t); if (FileHash(bytes.ToArray()) != r.EvidenceHash) throw ContractException.Conflict("inspection_evidence_integrity_failed"); }
        var hashes = new Dictionary<Guid, string>();
        var evidence = await repository.InspectionEvidenceAsync(c.Id, t);
        foreach (var id in x.EvidenceIds.Concat(inspected.SelectMany(a => a.EvidenceIds ?? []))
                     .Concat(roomEvidence).Concat(keyEvidence).Distinct())
        {
            var item = evidence.SingleOrDefault(e => e.Id == id && e.UploadedByUserId == Actor) ?? throw ContractException.Invalid("invalid_handover_evidence");
            using var bytes = new MemoryStream(); await storage.CopyToAsync(item.ObjectKey, bytes, t);
            images.Validate(bytes.ToArray()); hashes[id] = FileHash(bytes.ToArray()); item.IsLinked = true;
        }
        var observed = new HandoverSnapshot(Today, c.Room.RoomNumber, HandoverText(x.RoomCondition, 2000), HandoverText(x.KeysAndAccess, 2000), x.Notes.Trim(),
            inspected, electricity, water, x.EvidenceIds, inventory?.StateToken, inventory?.State, inventory?.NoAssetsConfirmed ?? false,
            MissingBaselineReason: legacy, OtherTenantsRemain: await repository.HasOtherActiveContractsAsync(c.RoomId, c.Id, t), EvidenceHashes: hashes,
            ProposedCompensation: HandoverText(x.ProposedCompensation, 2000, false),
            RoomChecks: roomChecks, AccessItems: accessItems, KeyEvidenceIds: keyEvidence);
        repository.Add(new ContractFinalInspection
        {
            ContractId = c.Id,
            Version = (await repository.FinalInspectionsAsync(c.Id, t)).Select(i => i.Version).DefaultIfEmpty(0).Max() + 1,
            BaselineContractId = root.Id,
            BaselineVersion = h?.Version ?? 0,
            BaselineSnapshot = JsonSerializer.Serialize(baseline),
            ObservedSnapshot = JsonSerializer.Serialize(observed),
            StaffId = Actor,
            InspectedAt = clock.GetUtcNow()
        });
    }
    public async Task<IReadOnlyList<FinalInspectionView>> FinalInspectionsAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        return (await repository.FinalInspectionsAsync(id, t)).Select(i => new FinalInspectionView(i.Id, i.Version, i.BaselineContractId, i.BaselineVersion,
            JsonSerializer.Deserialize<HandoverSnapshot>(i.BaselineSnapshot), JsonSerializer.Deserialize<HandoverSnapshot>(i.ObservedSnapshot)!, i.StaffId, i.InspectedAt, i.OwnerDecision, i.OwnerReason, i.ReviewedAt)).ToArray();
    }
    public Task<MoveOutView> RespondToInspectionAsync(Guid id, InspectionTenantFeedback x, Guid key, CancellationToken t) => Mutate(id, [Roles.Tenant], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-tenant-feedback", new { id, x }, t) is not null) return View(m);
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault() ?? throw ContractException.Missing();
        if (inspection.Version != x.Version || inspection.OwnerDecision is not null || m.Status != MoveOutStatus.Inspected) throw ContractException.Conflict("inspection_changed_or_reviewed");
        var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot)!;
        if (snapshot.TenantFeedback is not null) throw ContractException.Conflict("inspection_already_answered");
        snapshot = snapshot with { TenantFeedback = new(Actor, clock.GetUtcNow(), x.Confirmed, HandoverText(x.Reason, 2000, !x.Confirmed)) };
        inspection.ObservedSnapshot = JsonSerializer.Serialize(snapshot);
        m.Version++; MoveOutEvent(m, x.Confirmed ? "TenantInspectionConfirmed" : "TenantInspectionDisputed");
        Audit("ContractInspectionTenantResponded", id); Remember(key, "inspection-tenant-feedback", new { id, x }, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> ReviewInspectionAsync(Guid id, InspectionReviewInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-review", new { id, x }, t) is not null) return View(m);
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault() ?? throw ContractException.Conflict("confirmed_handover_baseline_required");
        if (inspection.Version != x.Version || inspection.OwnerDecision != null || m.Status != MoveOutStatus.Inspected) throw ContractException.Conflict("inspection_changed_or_reviewed");
        var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot)!;
        var reason = HandoverText(x.Reason, 2000);
        if (x.Confirmed && handoverInventory is not null)
        {
            if (snapshot.TenantFeedback?.Confirmed != true && (!x.TenantException || string.IsNullOrWhiteSpace(x.TenantExceptionReason)))
                throw ContractException.Conflict("tenant_inspection_response_or_owner_exception_required");
            var exception = snapshot.TenantFeedback?.Confirmed == true ? "Tenant confirmed observed condition" : HandoverText(x.TenantExceptionReason, 2000);
            await handoverInventory.SynchronizeAsync(c.RoomId, id, inspection.Version, snapshot, Actor, t);
            await handoverInventory.MarkForReviewAsync(c.RoomId, id, inspection.Version, Actor, t);
            snapshot = snapshot with { OwnerAcceptance = new(inspection.Version, Actor, clock.GetUtcNow(), reason, exception) };
            inspection.ObservedSnapshot = JsonSerializer.Serialize(snapshot);
        }
        inspection.OwnerReason = reason; inspection.OwnerDecision = x.Confirmed ? "Confirmed" : "Reinspection"; inspection.OwnerId = Actor; inspection.ReviewedAt = clock.GetUtcNow();
        inspection.NoAdditionalCharges = x.Confirmed && x.NoAdditionalCharges;
        if (!x.Confirmed) m.Status = MoveOutStatus.Approved;
        m.Version++; MoveOutEvent(m, x.Confirmed ? "InspectionConfirmed" : "ReinspectionRequired"); Audit("ContractInspectionReviewed", id); Remember(key, "inspection-review", new { id, x }, m.Id); return View(m);
    }, t);
}
