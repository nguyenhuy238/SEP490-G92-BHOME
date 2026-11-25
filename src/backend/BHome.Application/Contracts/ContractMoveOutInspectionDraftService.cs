using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private async Task<MoveOutInspectionDraftState> WorkingMoveOutDraft(
        Contract contract, CancellationToken token)
    {
        if (handoverRepository is null)
            throw new ContractException(503, "move_out_draft_storage_unavailable");
        var move = await repository.MoveOutAsync(contract.Id, token) ?? throw ContractException.Missing();
        if (contract.Status != ContractStatus.Active || move.Status != MoveOutStatus.Approved ||
            move.InspectionStaffId is { } reserved && reserved != Actor ||
            Today < move.ProposedDate)
            throw ContractException.Conflict("move_out_not_ready_for_inspection");
        await handoverRepository.RequireMoveOutTaskStartedAsync(contract.Id, Actor, token);
        var prior = await handoverRepository.MoveOutInspectionDraftAsync(contract.Id, token);
        if (prior is null)
            return MoveOutInspectionDraftState.Empty(contract.Id, Actor, contract.SnapshotHash, clock.GetUtcNow());
        if (prior.ContractId != contract.Id || prior.StaffUserId != Actor ||
            prior.ContractSnapshotHash != contract.SnapshotHash || prior.Version < 1)
            throw ContractException.Conflict("move_out_draft_integrity_failed");
        return prior;
    }

    private static MoveOutInspectionDraftView MoveOutDraftView(MoveOutInspectionDraftState state) =>
        new(state.Version, state.ContractId, "Draft", state.RoomCondition, state.KeysAndAccess,
            state.Notes, state.Assets, state.RoomChecks, state.AccessItems, state.EvidenceIds,
            state.KeyEvidenceIds, state.ElectricityReadingId, state.WaterReadingId,
            state.InventoryToken, state.ProposedCompensation, state.UpdatedAt,
            state.PhysicalItemEvidence ?? []);

    public async Task<MoveOutInspectionDraftView> GetMoveOutInspectionDraftAsync(Guid id,
        CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff], token);
        if (user.IsInRole(Roles.Owner))
            return MoveOutDraftView(await ReadOwnerMoveOutDraft(contract, token)
                ?? throw ContractException.Missing());
        return MoveOutDraftView(await WorkingMoveOutDraft(contract, token));
    }

    // Read-only access for an authorized Owner. Never grant the Owner the
    // Staff write path, initialize a draft, or expose stale submitted data.
    private async Task<MoveOutInspectionDraftState?> ReadOwnerMoveOutDraft(
        Contract contract, CancellationToken token)
    {
        if (handoverRepository is null || contract.Status != ContractStatus.Active)
            return null;
        var move = await repository.MoveOutAsync(contract.Id, token);
        if (move?.Status != MoveOutStatus.Approved) return null;
        var draft = await handoverRepository.MoveOutInspectionDraftAsync(contract.Id, token);
        return draft is not null && draft.ContractId == contract.Id &&
            draft.ContractSnapshotHash == contract.SnapshotHash && draft.Version > 0 &&
            (move.InspectionStaffId is null || move.InspectionStaffId == draft.StaffUserId)
            ? draft : null;
    }

    public Task<MoveOutInspectionDraftView> SaveMoveOutInspectionDraftAsync(Guid id,
        MoveOutInspectionDraftWrite input, Guid key, CancellationToken token) =>
        Mutate(id, [Roles.Staff], async contract =>
        {
            if (input is null || input.Version < 0)
                throw ContractException.Invalid("invalid_move_out_draft_input");
            var prior = await WorkingMoveOutDraft(contract, token);
            if (await Replay(key, "move-out-inspection-draft-write", new { id, input }, token) is not null)
                return MoveOutDraftView(prior);
            if (prior.Version != input.Version)
                throw ContractException.Conflict("move_out_draft_version_changed");
            if (input.Assets is { Length: > 200 } || input.Assets?.Any(asset => asset is null) == true ||
                input.EvidenceIds is { Length: > 10 } || input.KeyEvidenceIds is { Length: > 5 } ||
                input.RoomCondition?.Length > 2000 || input.KeysAndAccess?.Length > 2000 ||
                input.Notes?.Length > 4000 || input.ProposedCompensation?.Length > 2000)
                throw ContractException.Invalid("invalid_move_out_draft_input");

            // Move-Out uses the current inventory even if no Move-In report
            // exists. Any optional confirmed opening snapshot only supplies
            // comparison quantities, never permission to start inspection.
            // One group can be saved at a time.
            var preparation = await InspectionPreparationAsync(id, token);
            if (prior.InventoryToken is { } previousToken && preparation.Inventory is { } current &&
                previousToken != current.StateToken)
                throw ContractException.Conflict("handover_asset_inventory_changed");
            if (input.InventoryToken is not null && preparation.Inventory is { } checkInventory &&
                input.InventoryToken != checkInventory.StateToken)
                throw ContractException.Conflict("handover_asset_inventory_changed");
            var source = preparation.InspectionGroups ?? [];
            var assets = prior.Assets;
            if (input.Assets is not null)
            {
                if (input.Assets.Select(asset => asset.Id).Distinct().Count() != input.Assets.Length ||
                    input.Assets.Any(asset => asset.Id == Guid.Empty || !source.Any(group => group.Id == asset.Id)) ||
                    preparation.Inventory is not null && input.InventoryToken != preparation.Inventory.StateToken)
                    throw ContractException.Conflict("handover_asset_inventory_changed");
                foreach (var asset in input.Assets)
                {
                    if (asset.Condition?.Length > 1000 || asset.Notes?.Length > 2000 ||
                        asset.EvidenceIds is { Length: > 5 } ||
                        asset.Checked && string.IsNullOrWhiteSpace(asset.Condition) ||
                        asset.PhysicalObservations is { Length: > 200 } ||
                        asset.PhysicalObservations?.Any(p => p is null || p.Id == Guid.Empty ||
                            p.Quantity is < 0 or > 10000 || p.HandedOverQuantity is < 0 ||
                            p.HandedOverQuantity > p.Quantity || p.Condition?.Length > 1000) == true)
                        throw ContractException.Invalid("invalid_move_out_draft_assets");
                    if (asset.PhysicalObservations is { } observations)
                    {
                        var physical = source.Single(group => group.Id == asset.Id).PhysicalAssets ?? [];
                        if (observations.Select(p => p.Id).Distinct().Count() != observations.Length ||
                            observations.Any(p => !physical.Any(item => item.Id == p.Id)))
                            throw ContractException.Conflict("handover_asset_inventory_changed");
                    }
                }
                // Id-specific merge is essential for auto-save on each group.
                assets = prior.Assets.Where(asset => !input.Assets.Any(next => next.Id == asset.Id))
                    .Concat(input.Assets).ToArray();
            }
            var roomChecks = MergeMoveOutRoomChecks(prior.RoomChecks, input.RoomChecks);
            var physicalItemEvidence = prior.PhysicalItemEvidence ?? [];
            if (input.PhysicalItemEvidence is { } updatedItems)
            {
                var normalizedItems = NormalizeMoveOutPhysicalItemEvidence(source, updatedItems);
                // PATCH can save one physical asset independently, just as it
                // can save a single room check or inventory group.
                physicalItemEvidence = updatedItems.Length == 0 ? [] :
                    physicalItemEvidence.Where(item => !normalizedItems.Any(next =>
                        next.AssetId == item.AssetId && next.PhysicalAssetId == item.PhysicalAssetId))
                        .Concat(normalizedItems).ToArray();
            }
            var access = input.AccessItems is null ? prior.AccessItems :
                NormalizeMoveOutKeys(input.AccessItems);
            var overall = input.EvidenceIds ?? prior.EvidenceIds;
            var keys = input.KeyEvidenceIds ?? prior.KeyEvidenceIds;
            var allEvidence = overall.Concat(keys)
                .Concat(roomChecks.SelectMany(check => check.EvidenceIds))
                .Concat(assets.SelectMany(asset => asset.EvidenceIds ?? []))
                .Concat(physicalItemEvidence.SelectMany(item => item.EvidenceIds)).ToArray();
            if (allEvidence.Length > 50 || allEvidence.Contains(Guid.Empty) ||
                allEvidence.Distinct().Count() != allEvidence.Length)
                throw ContractException.Invalid("invalid_move_out_draft_evidence");
            var uploaded = await repository.InspectionEvidenceAsync(id, token);
            if (allEvidence.Any(evidenceId => !uploaded.Any(file => file.Id == evidenceId &&
                    file.UploadedByUserId == Actor && !file.IsLinked)))
                throw ContractException.Conflict("inspection_evidence_not_available");

            var electricity = input.ElectricityReadingId ?? prior.ElectricityReadingId;
            var water = input.WaterReadingId ?? prior.WaterReadingId;
            // Guid.Empty is an explicit "clear the selection"; null leaves it alone.
            if (electricity == Guid.Empty) electricity = null;
            if (water == Guid.Empty) water = null;
            if (electricity is { } e && !await repository.ValidFinalReadingAsync(e, id,
                    contract.RoomId, UtilityType.Electricity, Today, token) ||
                water is { } w && !await repository.ValidFinalReadingAsync(w, id,
                    contract.RoomId, UtilityType.Water, Today, token))
                throw ContractException.Conflict("confirmed_final_readings_required");

            var next = prior with
            {
                Version = prior.Version + 1,
                UpdatedAt = clock.GetUtcNow(),
                RoomCondition = input.RoomCondition?.Trim() ?? prior.RoomCondition,
                KeysAndAccess = input.KeysAndAccess?.Trim() ?? prior.KeysAndAccess,
                Notes = input.Notes?.Trim() ?? prior.Notes,
                Assets = assets,
                RoomChecks = roomChecks,
                AccessItems = access,
                EvidenceIds = overall,
                KeyEvidenceIds = keys,
                PhysicalItemEvidence = physicalItemEvidence,
                ElectricityReadingId = electricity,
                WaterReadingId = water,
                InventoryToken = preparation.Inventory?.StateToken ?? prior.InventoryToken,
                ProposedCompensation = input.ProposedCompensation?.Trim() ?? prior.ProposedCompensation
            };
            if (!await handoverRepository!.ReplaceMoveOutInspectionDraftAsync(id, prior.Version, next, token))
                throw ContractException.Conflict("move_out_draft_version_changed");
            Audit("ContractMoveOutInspectionDraftUpdated", id);
            Remember(key, "move-out-inspection-draft-write", new { id, input }, id);
            return MoveOutDraftView(next);
        }, token);
}
