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
            // An inventory entry missing from an accepted Move-In snapshot is
            // not proof that this tenancy received ZERO of that asset. Keep
            // starting quantities unknown, including for later-added assets.
            .Select(a => a with { ConfiguredQuantity = null, HandedOverQuantity = null }));
        return groups.ToArray();
    }
    private async Task<HandoverAsset[]> MoveOutInspectionGroups(Contract c,
        HandoverSnapshot? baseline, HandoverInventory? inventory, CancellationToken t)
    {
        if (inventory is not null) return InspectionGroups(baseline, inventory);
        if (baseline is not null) return baseline.Assets;
        // Older contracts have no structured room-inventory projection and may
        // have no Move-In at all. Use only today's room assets as observations;
        // never synthesize a previous check-in quantity or signed baseline.
        return (await Handovers.AssetsAsync(c.RoomId, t))
            .Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray();
    }
    private static bool HasVerifiedOpeningQuantity(HandoverSnapshot? baseline, Guid groupId) =>
        baseline?.Assets.Any(a => a.Id == groupId && a.HandedOverQuantity is not null) == true;

    // Move-Out has its own checklist rules. Keep Move-In validation (including
    // its signed handover requirements) unchanged.
    private static HandoverRoomCheck[] MergeMoveOutRoomChecks(
        HandoverRoomCheck[]? prior, HandoverRoomCheck[]? input)
    {
        var previous = prior ?? [];
        if (input is null) return previous;
        var codes = HandoverRoomChecklist.RequiredCodes;
        if (input.Length > codes.Length || input.Any(item => item is null) ||
            input.Select(item => item.Code).Distinct(StringComparer.Ordinal).Count() != input.Length)
            throw ContractException.Invalid("invalid_move_out_room_checks");
        var normalized = input.Select(item =>
        {
            if (!codes.Contains(item.Code) || item.Status is not ("Passed" or "Issue") ||
                item.Notes?.Length > 2000 ||
                item.Status == "Issue" && string.IsNullOrWhiteSpace(item.Notes) ||
                item.EvidenceIds is null or { Length: > 5 } ||
                item.EvidenceIds.Contains(Guid.Empty) ||
                item.EvidenceIds.Distinct().Count() != item.EvidenceIds.Length)
                throw ContractException.Invalid("invalid_move_out_room_checks");
            return item with { Notes = item.Status == "Issue" ? item.Notes!.Trim() : null };
        }).ToArray();
        return previous.Where(item => !normalized.Any(next => next.Code == item.Code))
            .Concat(normalized).OrderBy(item => Array.IndexOf(codes, item.Code)).ToArray();
    }

    private static HandoverAccessItem[] NormalizeMoveOutKeys(HandoverAccessItem[]? input)
    {
        if (input is null) return [];
        if (input.Length != 1 || input[0] is null || input[0].Type != "RoomKey" ||
            input[0].Quantity is < 0 or > 100 || input[0].Notes?.Length > 500)
            throw ContractException.Invalid("invalid_move_out_keys");
        return [input[0] with { Notes = input[0].Notes?.Trim() ?? "" }];
    }

    private static bool IsMoveOutGood(string condition) =>
        condition.Equals("Tốt", StringComparison.OrdinalIgnoreCase) ||
        condition.Equals("Passed", StringComparison.OrdinalIgnoreCase) ||
        condition.Equals("Good", StringComparison.OrdinalIgnoreCase);

    // Verified per-physical-item notes/photos belong to the Move-Out observation
    // only; the signed Move-In asset/physical-observation schema is untouched.
    private static MoveOutPhysicalItemEvidence[] NormalizeMoveOutPhysicalItemEvidence(
        HandoverAsset[] groups, MoveOutPhysicalItemEvidence[]? entries)
    {
        if (entries is null) return [];
        if (entries.Length > 200 || entries.Any(item => item is null) ||
            entries.Select(item => (item.AssetId, item.PhysicalAssetId)).Distinct().Count() != entries.Length)
            throw ContractException.Invalid("invalid_move_out_physical_evidence");
        return entries.Select(item =>
        {
            if (item.AssetId == Guid.Empty || item.PhysicalAssetId == Guid.Empty ||
                !groups.Any(asset => asset.Id == item.AssetId &&
                    asset.PhysicalAssets?.Any(p => p.Id == item.PhysicalAssetId) == true) ||
                item.Notes?.Length > 2000 ||
                item.EvidenceIds is null or { Length: > 5 } ||
                item.EvidenceIds.Contains(Guid.Empty) ||
                item.EvidenceIds.Distinct().Count() != item.EvidenceIds.Length)
                throw ContractException.Invalid("invalid_move_out_physical_evidence");
            return item with { Notes = item.Notes?.Trim() };
        }).ToArray();
    }

    private static HandoverAsset[] InspectMoveOutAssets(HandoverAsset[] groups,
        HandoverAssetInput[] inputs, HandoverSnapshot? baseline, bool requiresQuantities)
    {
        if (inputs is null || inputs.Length != groups.Length || inputs.Length > 200 ||
            inputs.Any(i => i is null) ||
            inputs.Select(i => i.Id).Distinct().Count() != inputs.Length ||
            groups.Any(group => !inputs.Any(i => i.Id == group.Id)))
            throw ContractException.Invalid("handover_asset_inventory_changed");
        return groups.Select(group =>
        {
            var input = inputs.Single(i => i.Id == group.Id);
            if (string.IsNullOrWhiteSpace(input.Condition) || input.Condition.Length > 1000 ||
                input.Notes?.Length > 2000 || input.EvidenceIds is { } photos &&
                (photos.Length > 5 || photos.Contains(Guid.Empty) || photos.Distinct().Count() != photos.Length))
                throw ContractException.Invalid("invalid_move_out_asset");
            var physical = group.PhysicalAssets ?? [];
            var observations = input.PhysicalObservations;
            if (observations is not null &&
                (observations.Length != physical.Length || observations.Any(p => p is null ||
                    !physical.Any(item => item.Id == p.Id) || p.Quantity is < 0 or > 10000 ||
                    string.IsNullOrWhiteSpace(p.Condition) || p.Condition.Length > 1000 ||
                    p.HandedOverQuantity is < 0 || p.HandedOverQuantity > p.Quantity) ||
                    observations.Select(p => p.Id).Distinct().Count() != observations.Length))
                throw ContractException.Invalid("invalid_move_out_physical_quantities");
            var observedQuantity = input.ObservedQuantity ?? observations?.Sum(p => p.Quantity);
            var needsQuantity = requiresQuantities &&
                (group.ConfiguredQuantity is not null || group.HandedOverQuantity is not null || physical.Length > 0);
            if (needsQuantity && observedQuantity is null || observedQuantity is < 0 or > 10000 ||
                observations is not null && observations.Sum(p => p.Quantity) != observedQuantity ||
                input.HandedOverQuantity is < 0 or > 10000 ||
                input.HandedOverQuantity is { } returned && returned > observedQuantity ||
                input.MissingQuantity is < 0 or > 10000)
                throw ContractException.Invalid("invalid_move_out_asset_quantities");
            var breakdown = new[] { input.GoodQuantity, input.WornQuantity, input.DamagedQuantity };
            if (breakdown.Any(count => count is not null) &&
                (breakdown.Any(count => count is null or < 0 or > 10000) ||
                    breakdown.Sum(count => count!.Value) != observedQuantity))
                throw ContractException.Invalid("invalid_move_out_asset_quantities");

            // Only a verified Move-In handover establishes the opening count.
            // Missing/lost quantities remain observations; settlement still
            // requires a separate Owner decision and a verified baseline.
            var opening = baseline?.Assets.FirstOrDefault(asset => asset.Id == group.Id);
            var known = opening?.HandedOverQuantity is not null;
            var missing = known && observedQuantity is { } count
                ? Math.Max(0, opening!.HandedOverQuantity!.Value - count) : (int?)null;
            if (known && observedQuantity is null || known && input.MissingQuantity is { } clientMissing &&
                clientMissing != missing)
                throw ContractException.Invalid("invalid_move_out_asset_quantities");
            var issue = !IsMoveOutGood(input.Condition.Trim()) ||
                known && observedQuantity != opening!.HandedOverQuantity ||
                input.HandedOverQuantity is { } handedOver && handedOver != observedQuantity ||
                input.WornQuantity > 0 || input.DamagedQuantity > 0;
            if (issue && string.IsNullOrWhiteSpace(input.Notes))
                throw ContractException.Invalid("move_out_asset_issue_reason_required");
            return group with
            {
                ObservedCondition = input.Condition.Trim(),
                ObservedQuantity = observedQuantity,
                // Current inventory does not prove a separate handover count or
                // how many units are good, worn or damaged. Preserve unknowns.
                HandedOverQuantity = input.HandedOverQuantity,
                GoodQuantity = input.GoodQuantity,
                WornQuantity = input.WornQuantity,
                DamagedQuantity = input.DamagedQuantity,
                MissingQuantity = missing,
                Checked = input.Checked,
                Notes = input.Notes?.Trim(),
                EvidenceIds = input.EvidenceIds ?? [],
                PhysicalObservations = observations
            };
        }).ToArray();
    }

    private static void RequireMoveOutPhysicalReasons(HandoverAsset[] inspected,
        HandoverSnapshot? baseline, MoveOutPhysicalItemEvidence[] evidence)
    {
        foreach (var group in inspected)
        {
            var openingGroup = baseline?.Assets.FirstOrDefault(asset => asset.Id == group.Id);
            foreach (var item in group.PhysicalObservations ?? [])
            {
                var openingPhysical = openingGroup?.PhysicalObservations?.FirstOrDefault(p => p.Id == item.Id);
                var received = openingGroup?.HandedOverQuantity is not null
                    ? openingPhysical?.HandedOverQuantity ?? openingPhysical?.Quantity ??
                      openingGroup.PhysicalAssets?.FirstOrDefault(p => p.Id == item.Id)?.Quantity
                    : null;
                if ((!IsMoveOutGood(item.Condition.Trim()) ||
                     received is { } initial && item.Quantity != initial) &&
                    !evidence.Any(p => p.AssetId == group.Id && p.PhysicalAssetId == item.Id &&
                        !string.IsNullOrWhiteSpace(p.Notes)))
                    throw ContractException.Invalid("move_out_physical_issue_reason_required");
            }
        }
    }
    public async Task<InspectionPreparation> InspectionPreparationAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff], t); var (root, h) = await Baseline(c, t);
        var baseline = h is null ? null : await EffectiveBaseline(c, Snapshot(h), t);
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(c.RoomId, t);
        return new(h is null ? null : HandoverView(h) with { Snapshot = baseline! }, h is null ? null : root.Id,
            await repository.FinalReadingsAsync(id, c.RoomId, Today, t), await repository.HasOtherActiveContractsAsync(c.RoomId, id, t),
            inventory, await MoveOutInspectionGroups(c, baseline, inventory, t), await LegacyException(c, t),
            // Move-Out is a separate inspection. Historical Move-In quantities
            // may be unknown, but that must never prevent Staff observations.
            false);
    }
    private async Task RecordFinalInspection(Contract c, InspectionInput x, CancellationToken t)
    {
        var (root, h) = await Baseline(c, t);
        var missingQuantities = !HasQuantityBaseline(h);
        var legacy = missingQuantities ? await LegacyException(c, t) : null;
        // A missing Move-In baseline affects only comparison/possible damage
        // attribution, not Staff's ability to inspect an occupied room.
        if (x.Assets is null) throw ContractException.Invalid("inspection_checklist_required");
        var baseline = h is null ? null : await EffectiveBaseline(c, Snapshot(h), t);
        // Every Move-Out inspection must inspect the seven room areas and
        // record returned keys, regardless of how old the Move-In snapshot is.
        if (x.RoomChecks is null || x.AccessItems is null)
            throw ContractException.Invalid("move_out_four_sections_required");
        var roomChecks = MergeMoveOutRoomChecks(null, x.RoomChecks);
        var accessItems = NormalizeMoveOutKeys(x.AccessItems);
        if (roomChecks.Length != HandoverRoomChecklist.RequiredCodes.Length)
            throw ContractException.Invalid("move_out_room_checklist_incomplete");
        if (accessItems.Length == 0)
            throw ContractException.Invalid("move_out_access_checklist_required");
        var keyEvidence = x.KeyEvidenceIds ?? [];
        if (keyEvidence.Length > 5 || keyEvidence.Contains(Guid.Empty) ||
            keyEvidence.Distinct().Count() != keyEvidence.Length)
            throw ContractException.Invalid("invalid_move_out_key_evidence");
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(c.RoomId, t);
        if (inventory is not null && inventory.StateToken != x.InventoryToken) throw ContractException.Conflict("handover_asset_inventory_changed");
        if (inventory is { Groups.Length: 0, NoAssetsConfirmed: false }) throw ContractException.Conflict("owner_no_assets_confirmation_required");
        var groups = await MoveOutInspectionGroups(c, baseline, inventory, t);
        var inspected = InspectMoveOutAssets(groups, x.Assets, baseline, inventory is not null);
        var physicalItemEvidence = NormalizeMoveOutPhysicalItemEvidence(inspected, x.PhysicalItemEvidence);
        RequireMoveOutPhysicalReasons(inspected, baseline, physicalItemEvidence);
        var unknownOpeningQuantities = missingQuantities ||
            groups.Any(group => !HasVerifiedOpeningQuantity(baseline, group.Id));
        var overallEvidence = x.EvidenceIds ?? [];
        HandoverChecklist.RequireSeparateEvidence(overallEvidence, inspected);
        if (inspected.Any(a => !a.Checked)) throw ContractException.Invalid("handover_checklist_incomplete");
        HandoverRoomChecklist.RequireSeparateKeyEvidence(keyEvidence, overallEvidence, roomChecks, x.Assets);
        var roomEvidence = roomChecks.SelectMany(check => check.EvidenceIds).ToArray();
        if (roomEvidence.Distinct().Count() != roomEvidence.Length ||
            roomEvidence.Intersect(overallEvidence).Any() ||
            roomEvidence.Intersect(inspected.SelectMany(asset => asset.EvidenceIds ?? [])).Any())
            throw ContractException.Invalid("move_out_room_evidence_must_be_separate");
        var physicalEvidence = physicalItemEvidence.SelectMany(item => item.EvidenceIds).ToArray();
        if (physicalEvidence.Distinct().Count() != physicalEvidence.Length ||
            physicalEvidence.Intersect(overallEvidence.Concat(keyEvidence).Concat(roomEvidence)
                .Concat(inspected.SelectMany(asset => asset.EvidenceIds ?? []))).Any())
            throw ContractException.Invalid("move_out_physical_evidence_must_be_separate");
        var allPhotos = overallEvidence.Concat(keyEvidence).Concat(roomEvidence)
            .Concat(inspected.SelectMany(asset => asset.EvidenceIds ?? [])).Concat(physicalEvidence).ToArray();
        if (allPhotos.Length > 250 || allPhotos.Contains(Guid.Empty) ||
            allPhotos.Distinct().Count() != allPhotos.Length)
            throw ContractException.Invalid("move_out_evidence_must_be_separate");
        var readings = await repository.FinalReadingsAsync(c.Id, c.RoomId, Today, t);
        var electricity = readings.Single(r => r.Id == x.ElectricityReadingId); var water = readings.Single(r => r.Id == x.WaterReadingId);
        var evidence = await repository.InspectionEvidenceAsync(c.Id, t);
        var actor = Actor;
        // Resolve every identity/ownership/link guard using the EF context
        // BEFORE starting parallel MinIO I/O. Never query or mutate tracked
        // entities concurrently: DbContext is not thread-safe.
        var photosToLink = allPhotos.Select(id =>
            evidence.SingleOrDefault(item => item.Id == id && item.UploadedByUserId == actor &&
                !item.IsLinked) ?? throw ContractException.Invalid("invalid_handover_evidence")).ToArray();

        // Each MinIO CopyToAsync creates its own client. Bound concurrent
        // downloads to avoid N sequential network round-trips without opening
        // hundreds of sockets or buffering all the images at once.
        using var fetchSlots = new SemaphoreSlim(4, 4);
        async Task<(Guid? PhotoId, string Hash)> FetchAndVerifyAsync(
            Guid? photoId, string objectKey, string? expectedHash, bool image)
        {
            await fetchSlots.WaitAsync(t);
            try
            {
                using var buffer = new MemoryStream();
                await storage.CopyToAsync(objectKey, buffer, t);
                // One byte[] allocation per object instead of the previous
                // double ToArray() for every inspection photo.
                var content = buffer.ToArray();
                if (image) images.Validate(content);
                var hash = FileHash(content);
                if (expectedHash is not null && hash != expectedHash)
                    throw ContractException.Conflict("inspection_evidence_integrity_failed");
                return (photoId, hash);
            }
            finally { fetchSlots.Release(); }
        }

        var checks = new[]
        {
            FetchAndVerifyAsync(null, electricity.EvidenceObjectKey, electricity.EvidenceHash, false),
            FetchAndVerifyAsync(null, water.EvidenceObjectKey, water.EvidenceHash, false)
        }.Concat(photosToLink.Select(item =>
            FetchAndVerifyAsync(item.Id, item.ObjectKey, null, true))).ToArray();
        // Task.WhenAll observes ALL download/validation tasks, including when
        // one fails. Nothing is linked until all bytes and hashes are valid.
        var verified = await Task.WhenAll(checks);
        var hashes = verified.Where(item => item.PhotoId is not null)
            .ToDictionary(item => item.PhotoId!.Value, item => item.Hash);
        foreach (var item in photosToLink) item.IsLinked = true;
        var roomCondition = string.IsNullOrWhiteSpace(x.RoomCondition)
            ? $"{roomChecks.Count(check => check.Status == "Passed")} mục tốt, {roomChecks.Count(check => check.Status == "Issue")} mục có vấn đề."
            : HandoverText(x.RoomCondition, 2000);
        var keysAndAccess = string.IsNullOrWhiteSpace(x.KeysAndAccess)
            ? $"Đã nhận lại {accessItems[0].Quantity} chìa khóa phòng."
            : HandoverText(x.KeysAndAccess, 2000);
        var observed = new HandoverSnapshot(Today, c.Room.RoomNumber, roomCondition, keysAndAccess, x.Notes?.Trim() ?? "",
            inspected, electricity, water, overallEvidence, inventory?.StateToken, inventory?.State, inventory?.NoAssetsConfirmed ?? false,
            // Preserve the absence of verified starting quantities for audit:
            // no fabricated zero baseline, and no automatic liability.
            MissingBaselineReason: unknownOpeningQuantities
                ? legacy ?? "Không có số lượng đầu vào đã xác thực; số lượng ban đầu chưa xác định."
                : null,
            OtherTenantsRemain: await repository.HasOtherActiveContractsAsync(c.RoomId, c.Id, t), EvidenceHashes: hashes,
            ProposedCompensation: HandoverText(x.ProposedCompensation, 2000, false),
            RoomChecks: roomChecks, AccessItems: accessItems, KeyEvidenceIds: keyEvidence,
            PhysicalItemEvidence: physicalItemEvidence);
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
    public async Task CopyMoveOutFinalMeterEvidenceAsync(Guid id, Guid readingId, Stream output, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        if (readingId == Guid.Empty) throw ContractException.Missing();

        // Only the two readings actually committed with an immutable Staff
        // Final inspection qualify. An uploaded photo, confirmed meter reading
        // or working draft alone never grants the Tenant access to its bytes.
        HandoverReading? recorded = null;
        foreach (var inspection in await repository.FinalInspectionsAsync(id, t))
        {
            var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot)
                ?? throw ContractException.Conflict("move_out_inspection_integrity_failed");
            recorded = new[] { snapshot.Electricity, snapshot.Water }
                .SingleOrDefault(reading => reading.Id == readingId);
            if (recorded is not null) break;
        }
        if (recorded is null) throw ContractException.Missing();

        // Recheck persistence, task purpose, completed confirmation, linked
        // evidence, room and exact ContractId. Never trust client IDs or a
        // snapshot alone for access to MinIO.
        var current = await repository.ConfirmedFinalInspectionReadingAsync(id, contract.RoomId, readingId, t)
            ?? throw ContractException.Missing();
        if (recorded.EvidenceId != current.EvidenceId || recorded.EvidenceHash != current.EvidenceHash ||
            recorded.UtilityType != current.UtilityType || recorded.Date != current.Date ||
            recorded.Value != current.Value || recorded.MeterCode != current.MeterCode)
            throw ContractException.Conflict("inspection_evidence_integrity_failed");

        using var buffer = new MemoryStream();
        await storage.CopyToAsync(current.EvidenceObjectKey, buffer, t);
        var bytes = buffer.ToArray();
        if (FileHash(bytes) != recorded.EvidenceHash)
            throw ContractException.Conflict("inspection_evidence_integrity_failed");
        await output.WriteAsync(bytes, t);
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
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault() ?? throw ContractException.Conflict("move_out_inspection_required");
        if (inspection.Version != x.Version || inspection.OwnerDecision != null || m.Status != MoveOutStatus.Inspected) throw ContractException.Conflict("inspection_changed_or_reviewed");
        var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot)!;
        var reason = HandoverText(x.Reason, 2000);
        if (x.Confirmed && handoverInventory is not null)
        {
            // Move-Out is not an agreement for Tenant/Owner to sign. Optional
            // historical Tenant feedback is retained as factual context, but
            // neither a Tenant response nor an Owner "signature exception" is
            // required to review the Staff's physical observations.
            await handoverInventory.SynchronizeAsync(c.RoomId, id, inspection.Version, snapshot, Actor, t);
            await handoverInventory.MarkForReviewAsync(c.RoomId, id, inspection.Version, Actor, t);
        }
        // Owner's actual review decision, actor, reason and timestamp remain
        // recorded on ContractFinalInspection; do not synthesize an acceptance
        // signature or a signed handover snapshot.
        inspection.OwnerReason = reason; inspection.OwnerDecision = x.Confirmed ? "Confirmed" : "Reinspection"; inspection.OwnerId = Actor; inspection.ReviewedAt = clock.GetUtcNow();
        inspection.NoAdditionalCharges = x.Confirmed && x.NoAdditionalCharges;
        if (handoverRepository is not null)
            await handoverRepository.ReviewMoveOutTaskAsync(id, Actor, x.Confirmed, clock.GetUtcNow(), t);
        // Reinspection is a new physical observation. The prior final inspection
        // retains its immutable linked photos; clear only the unsent working draft
        // so linked evidence cannot be silently reused as a fresh observation.
        if (!x.Confirmed && handoverRepository is not null && m.InspectedByUserId is { } staffId)
            await handoverRepository.ResetMoveOutInspectionDraftAsync(id, staffId,
                c.SnapshotHash, clock.GetUtcNow(), t);
        if (!x.Confirmed) m.Status = MoveOutStatus.Approved;
        m.Version++; MoveOutEvent(m, x.Confirmed ? "InspectionConfirmed" : "ReinspectionRequired"); Audit("ContractInspectionReviewed", id); Remember(key, "inspection-review", new { id, x }, m.Id); return View(m);
    }, t);
}
