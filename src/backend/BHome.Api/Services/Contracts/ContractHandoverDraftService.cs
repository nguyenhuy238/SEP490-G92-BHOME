using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IHandoverDraftRepository Drafts => handoverDrafts ?? throw new ContractException(503, "handover_draft_unavailable");

    public Task<HandoverInboxPage> ListHandoverInboxAsync(int page, int pageSize,
        Guid? locationId, string? status, string? roomSearch, CancellationToken token)
    {
        Role(Roles.Owner);
        if (page < 1 || page > 100_000 || pageSize < 1 || pageSize > 50 ||
            (status is not null && status.Length > 64) ||
            (roomSearch is not null && roomSearch.Length > 80))
            throw ContractException.Invalid("invalid_handover_inbox_filter");
        return Drafts.ListAsync(page, pageSize, locationId, string.IsNullOrWhiteSpace(status) ? null : status,
            roomSearch?.Trim() ?? "", token);
    }

    private static void RequireMainHandover(Contract contract)
    {
        if (contract.Kind != ContractKind.Main || contract.PreviousContractId is not null ||
            contract.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Expired)
            throw ContractException.Conflict("main_move_in_handover_required");
    }

    private async Task RequireStartedMoveInWork(Contract contract, CancellationToken token)
    {
        // Contract access is authorized by Load/Mutate. A contract-scoped
        // draft is not itself proof that the assigned Staff started work.
        var task = await Handovers.MoveInTaskAsync(contract.Id, contract.RoomId, Actor, false, token);
        if (task?.CanInspect != true)
            throw ContractException.Conflict("move_in_task_not_started");
    }

    private async Task<HandoverDraftState> DraftState(Contract contract, CancellationToken token)
    {
        var state = await Drafts.GetAsync(contract.Id, token);
        if (state is not null) return state;
        // Existing Main contracts may already have an in-progress or completed
        // handover under the original API. Never replace/overlay their legacy
        // baseline with a synthetic new Draft: the clients should fall back
        // to the original workflow when this endpoint returns 404.
        if (await Handovers.GetAsync(contract.Id, token) is not null)
            throw ContractException.Missing();
        // Older contracts predate automatic preparation. They can be initialized
        // on the first write; a GET never performs a hidden mutation.
        return HandoverDraftState.Create(contract, clock.GetUtcNow()) with { Version = 0 };
    }

    private async Task RequireLegacyHandoverCompatibility(Contract contract, CancellationToken token)
    {
        // Legacy routes remain usable for historical Main/Renewal handovers,
        // but must not bypass Owner Ready/feedback in newly created Drafts.
        if (contract.Kind == ContractKind.Main && contract.PreviousContractId is null &&
            handoverDrafts is not null && await Drafts.GetAsync(contract.Id, token) is not null)
            throw ContractException.Conflict("handover_draft_workflow_required");
    }

    private async Task SaveDraftState(Contract contract, HandoverDraftState prior,
        HandoverDraftState next, string action, CancellationToken token)
    {
        if (!await Drafts.ReplaceAsync(contract.Id, prior.Version, next, token))
            throw ContractException.Conflict("handover_draft_version_changed");
        Audit("ContractHandoverDraft" + action, contract.Id);
        await Handovers.NotifyAsync(contract, "HandoverDraft" + action, Actor, next.Version, token);
    }

    private static string DraftText(string value, int maximum, bool required = false)
    {
        var result = value.Trim();
        if (result.Length > maximum || required && result.Length == 0)
            throw ContractException.Invalid("invalid_handover_draft_input");
        return result;
    }

    private static HandoverAsset WithDraftObservations(HandoverAsset source, HandoverAssetInput? input) => input is null
        ? source : source with
        {
            ObservedCondition = input.Condition,
            ObservedQuantity = input.ObservedQuantity,
            HandedOverQuantity = input.HandedOverQuantity,
            GoodQuantity = input.GoodQuantity,
            WornQuantity = input.WornQuantity,
            DamagedQuantity = input.DamagedQuantity,
            MissingQuantity = input.MissingQuantity,
            Checked = input.Checked,
            Notes = input.Notes,
            EvidenceIds = input.EvidenceIds,
            PhysicalObservations = input.PhysicalObservations
        };

    private static bool LegacyAssetPassed(HandoverAsset asset) =>
        asset.Checked && asset.ObservedCondition.Trim() is ("Good" or "Tốt" or "Đạt") &&
        asset.ObservedQuantity is { } observed && asset.HandedOverQuantity == observed &&
        asset.GoodQuantity == observed && asset.WornQuantity == 0 &&
        asset.DamagedQuantity == 0 && asset.MissingQuantity == 0 &&
        (asset.ConfiguredQuantity is null || observed == asset.ConfiguredQuantity);

    private async Task<HandoverDraftView> DraftView(Contract contract, HandoverDraftState state, CancellationToken token)
    {
        var moveInTask = await Handovers.MoveInTaskAsync(contract.Id, contract.RoomId,
            user.IsInRole(Roles.Staff) ? Actor : null, user.IsInRole(Roles.Owner), token);
        var readings = await Handovers.ReadingsAsync(contract.Id, contract.RoomId, contract.StartDate, token);
        var electricity = readings.Where(r => r.UtilityType == 0).OrderByDescending(r => r.Date).ThenBy(r => r.Id).FirstOrDefault();
        var water = readings.Where(r => r.UtilityType == 1).OrderByDescending(r => r.Date).ThenBy(r => r.Id).FirstOrDefault();
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareForContractAsync(
            contract.RoomId, contract.TenantUserId, token);
        var source = inventory?.Groups ?? (await Handovers.AssetsAsync(contract.RoomId, token))
            .Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray();
        var assets = source.Select(a => WithDraftObservations(a, state.Assets.SingleOrDefault(s => s.Id == a.Id))).ToArray();
        var canonical = await Handovers.CompletedInventoryAsync(contract.Id, token);
        var canonicalTask = moveInTask?.InventoryTaskId is not null || canonical is not null;
        var missing = new List<string>();
        if (contract.Status != ContractStatus.Active) missing.Add("contract_active");
        if (contract.TenantUserId is null) missing.Add("tenant_account");
        if (electricity is null) missing.Add("electricity");
        if (water is null) missing.Add("water");
        if (electricity is not null && water is not null && electricity.Date != water.Date)
            missing.Add("meter_readings_same_day");
        // Older approved drafts can contain multiple access types, so preserve
        // their confirmed behavior without blocking Tenant acknowledgment.
        var legacyApproved = state.KeyEvidenceIds is null && state.Status is ("Ready" or "Confirmed");
        missing.AddRange(HandoverRoomChecklist.Missing(state.RoomChecks, state.AccessItems, state.OutstandingIssues)
            .Where(reason => !legacyApproved || reason != "access_inventory"));
        if (state.Status is "Draft" or "ReinspectionRequested")
            AddDraftEvidenceRequirements(state, missing);
        if (canonicalTask)
        {
            // Completed MoveInInventory is the factual Staff inspection. An
            // older optional draft.assets copy or draft.InventoryToken must
            // never fabricate incomplete or changed-inventory warnings.
            // Tenant is intentionally not given the internal inventory-task ID
            // or status. The verified Completed snapshot itself is authoritative
            // for every role; checking the redacted task status would falsely
            // block Tenant OTP signing after a valid Owner signature.
            if (canonical is null)
                missing.Add("move_in_inventory");
            else if (inventory is not null && !inventory.MatchesMoveInSourceToken(canonical.SourceToken))
                missing.Add("inventory_changed");
        }
        else
        {
            if (inventory is { Groups.Length: 0, NoAssetsConfirmed: false } ||
                source.Length != state.Assets.Length || assets.Any(a => !a.Checked)) missing.Add("assets");
            else
            {
                try
                {
                    var inspected = HandoverChecklist.Inspect(source, state.Assets, inventory is not null);
                    HandoverChecklist.RequireSeparateEvidence(state.EvidenceIds, inspected);
                }
                catch (ContractException) { missing.Add("asset_quantities_or_evidence"); }
            }
            if (inventory is not null && state.InventoryToken != inventory.StateToken)
                missing.Add("inventory_changed");
        }
        if (state.StaffPreparedBy is null) missing.Add("staff_inspection");
        if (state.Status == "Draft" && state.StaffPreparedBy is null && moveInTask?.CanInspect != true &&
            user.IsInRole(Roles.Staff)) missing.Add("move_in_task_not_started");
        if (state.ContractSnapshotHash != contract.SnapshotHashOrEmpty) missing.Add("contract_changed");
        // Recorded defects are disclosed in the signed report, not missing data.
        var selectedReinspection = state.ReinspectionItems ?? [];
        var latestRequestAt = state.ReinspectionHistory?.LastOrDefault()?.RequestedAt;
        if (latestRequestAt is not null && canonical is not null &&
            canonical.CompletedAt > latestRequestAt)
        {
            selectedReinspection = selectedReinspection.Select(item => item with
            {
                Rechecked = item.Rechecked || item.Kind == "Asset" &&
                    canonical.Items.Any(asset => asset.Id == item.AssetId &&
                        asset.Condition == "Good" && asset.ActualQuantity == asset.ExpectedQuantity &&
                        canonical.LatestEvidenceAt.TryGetValue(asset.Id, out var uploadedAt) &&
                        uploadedAt > latestRequestAt)
            }).ToArray();
        }
        return new(state.Version, state.Status, contract.Id, contract.Room.RoomNumber,
            contract.Room.Location.Name, contract.Room.Location.Address,
            contract.StartDate, contract.EndDate, contract.RentAmount, contract.RequiredDeposit,
            contract.Terms, electricity, water, assets, state.RoomCondition, state.KeysAndAccess,
            state.Notes, state.EvidenceIds, inventory?.StateToken,
            canonical?.Items.Length == 0 || (inventory?.NoAssetsConfirmed ?? false),
            state.OwnerReadyAt, state.TenantConfirmedAt, state.Requests, missing.Distinct().ToArray(),
            state.RoomChecks ?? [], state.AccessItems ?? [], state.OutstandingIssues ?? [], moveInTask,
            canonical?.Items.Any(a => a.Condition != "Good" || a.ActualQuantity != a.ExpectedQuantity)
                ?? await Handovers.InventoryHasIssuesAsync(contract.Id, token), state.KeyEvidenceIds,
            state.StaffSubmittedAt, state.OwnerSignature?.SignedAt, state.TenantSignature?.SignedAt,
            selectedReinspection, state.ReinspectionHistory ?? [],
            state.OwnerSignature?.FileHash, state.OwnerSignature?.Id, state.TenantSigning is not null,
            state.OwnerReadyReason, state.OwnerHandlingPlan,
            user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Staff) ? state.StaffSubmittedBy : null,
            canonical?.Items,
            user.IsInRole(Roles.Owner) && handoverInkRenderer is not null);
    }

    public async Task<HandoverDraftView> GetHandoverDraftAsync(Guid id, CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        RequireMainHandover(contract);
        var state = await DraftState(contract, token);
        var view = await DraftView(contract, state, token);
        // The inspection under Staff/Owner review is not yet a handover offer
        // to the Tenant. Retain status visibility without leaking draft photos
        // or unapproved notes and asset observations.
        if (user.IsInRole(Roles.Tenant) && state.Status is not ("Ready" or "Confirmed" or "ChangesRequested"))
            return view with
            {
                RoomCondition = "",
                KeysAndAccess = "",
                Notes = "",
                Assets = [],
                EvidenceIds = [],
                KeyEvidenceIds = [],
                RoomChecks = [],
                AccessItems = [],
                OutstandingIssues = [],
                ReinspectionItems = [],
                ReinspectionHistory = [],
                Missing = [],
                Electricity = null,
                Water = null,
                MoveInTask = null,
                InspectedAssets = null
            };
        return view;
    }

    public Task<HandoverDraftView> SaveHandoverDraftAsync(Guid id, HandoverDraftWrite input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Staff], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-write", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status is not ("Draft" or "ReinspectionRequested") || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_version_changed");
        await RequireStartedMoveInWork(contract, token);
        if (input.Assets is { Length: > 200 } || input.EvidenceIds is { Length: > 10 } ||
            input.KeyEvidenceIds is { Length: > 5 } ||
            input.Assets?.Any(a => a is null) == true || input.EvidenceIds is { } ids &&
                (ids.Contains(Guid.Empty) || ids.Distinct().Count() != ids.Length) ||
            input.KeyEvidenceIds is { } keys &&
                (keys.Contains(Guid.Empty) || keys.Distinct().Count() != keys.Length))
            throw ContractException.Invalid("invalid_handover_draft_input");
        var roomChecks = HandoverRoomChecklist.Merge(prior.RoomChecks, input.RoomChecks);
        var accessItems = input.AccessItems is null
            ? prior.AccessItems ?? [] : HandoverRoomChecklist.NormalizeAccess(input.AccessItems);
        if (input.RoomCondition is not null && (input.EvidenceIds ?? prior.EvidenceIds).Length == 0)
            throw ContractException.Invalid("room_summary_evidence_required");
        if (input.RoomChecks?.Any(check => check.Status != "NotApplicable" && check.EvidenceIds.Length == 0) == true)
            throw ContractException.Invalid("room_check_evidence_required");
        if (input.AccessItems is not null && (input.KeyEvidenceIds ?? prior.KeyEvidenceIds) is not { Length: > 0 })
            throw ContractException.Invalid("key_evidence_required");
        // Staff records factual defects in roomChecks, not repair actions.
        // Drop stale mutable proposal data from older drafts; immutable
        // already-confirmed historical documents remain untouched.
        _ = HandoverRoomChecklist.NormalizeIssues(input.OutstandingIssues);
        HandoverAssetInput[] assets = prior.Assets;
        string? inventoryToken = prior.InventoryToken;
        if (input.Assets is not null)
        {
            var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(contract.RoomId, token);
            var source = inventory?.Groups ?? (await Handovers.AssetsAsync(contract.RoomId, token))
                .Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray();
            if (input.Assets.Any(i => !source.Any(a => a.Id == i.Id)) ||
                input.Assets.Select(a => a.Id).Distinct().Count() != input.Assets.Length ||
                inventory is not null && input.InventoryToken != inventory.StateToken)
                throw ContractException.Conflict("handover_asset_inventory_changed");
            if (inventory is not null && prior.InventoryToken is not null &&
                prior.InventoryToken != inventory.StateToken &&
                source.Any(a => !input.Assets.Any(i => i.Id == a.Id)))
                throw ContractException.Conflict("handover_asset_inventory_changed");
            // Partial inspection is allowed: only checked groups must have valid
            // observations. Full cross-field quantity validation occurs at Ready.
            foreach (var asset in input.Assets)
                if (asset.Condition?.Length > 1000 || asset.Notes?.Length > 2000 ||
                    asset.EvidenceIds is { Length: > 5 } || asset.Checked && string.IsNullOrWhiteSpace(asset.Condition) ||
                    asset.EvidenceIds?.Distinct().Count() != (asset.EvidenceIds?.Length ?? 0))
                    throw ContractException.Invalid("invalid_handover_draft_assets");
                else if (asset.Checked && asset.EvidenceIds is not { Length: > 0 })
                    throw ContractException.Invalid("asset_evidence_required");
            // Saving one completed inspection must not erase other asset groups.
            // Staff may return multiple times and each checked group fills the
            // corresponding section of the same evolving draft.
            assets = source.Select(a => input.Assets.SingleOrDefault(i => i.Id == a.Id) ??
                prior.Assets.SingleOrDefault(i => i.Id == a.Id))
                .OfType<HandoverAssetInput>().ToArray();
            inventoryToken = inventory?.StateToken;
        }
        HandoverRoomChecklist.RequireSeparateKeyEvidence(input.KeyEvidenceIds ?? prior.KeyEvidenceIds,
            input.EvidenceIds ?? prior.EvidenceIds, roomChecks, assets);
        foreach (var evidenceId in (input.EvidenceIds ?? [])
                     .Concat(input.KeyEvidenceIds ?? [])
                     .Concat((input.RoomChecks ?? []).SelectMany(check => check.EvidenceIds))
                     .Concat((input.Assets ?? []).SelectMany(asset => asset.EvidenceIds ?? [])).Distinct())
        {
            var file = await Workflow.FileAsync(id, evidenceId, token);
            if (file?.Kind != ContractFileKind.HandoverEvidence)
                throw ContractException.Invalid("invalid_handover_evidence");
        }
        var canonicalInventoryTaskExists = (await Handovers.MoveInTaskAsync(
            contract.Id, contract.RoomId, Actor, false, token))?.InventoryTaskId is not null;
        var reinspection = (prior.ReinspectionItems ?? []).Select(item => item with
        {
            Rechecked = item.Rechecked || (item.Kind switch
            {
                "RoomCheck" => input.RoomChecks?.Any(check => check.Code == item.Code) == true,
                // A completed canonical task must be re-opened, inspected and
                // completed again through its own versioned evidence API.
                // Writing a duplicate draft.assets entry cannot fake rework.
                "Asset" => !canonicalInventoryTaskExists &&
                    input.Assets?.Any(asset => asset.Id == item.AssetId) == true,
                "Room" => input.RoomCondition is not null,
                "Access" => input.AccessItems is not null,
                _ => false
            })
        }).ToArray();
        var next = prior with
        {
            Version = prior.Version + 1,
            ContractSnapshotHash = contract.SnapshotHashOrEmpty,
            RoomCondition = input.RoomCondition is null ? prior.RoomCondition : DraftText(input.RoomCondition, 2000),
            KeysAndAccess = input.AccessItems is { Length: 1 } && accessItems[0].Type == "RoomKey"
                ? $"Bàn giao {accessItems[0].Quantity} chìa khóa"
                : input.KeysAndAccess is null ? prior.KeysAndAccess : DraftText(input.KeysAndAccess, 2000),
            Notes = input.Notes is null ? prior.Notes : DraftText(input.Notes, 4000),
            Assets = assets,
            EvidenceIds = input.EvidenceIds ?? prior.EvidenceIds,
            KeyEvidenceIds = input.KeyEvidenceIds ?? prior.KeyEvidenceIds,
            RoomChecks = roomChecks,
            AccessItems = accessItems,
            OutstandingIssues = [],
            InventoryToken = inventoryToken,
            StaffPreparedBy = Actor,
            StaffPreparedAt = clock.GetUtcNow(),
            OwnerReadyBy = null,
            OwnerReadyAt = null,
            ReinspectionItems = reinspection,
            OwnerSignature = null,
            TenantSigning = null,
            TenantSignature = null
        };
        await SaveDraftState(contract, prior, next, "Updated", token);
        Remember(key, "handover-draft-write", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    // Staff explicitly submits a complete, independently validated inspection.
    // Saving a partial checklist is never equivalent to completing the task.
    public Task<HandoverDraftView> SubmitHandoverDraftAsync(Guid id, HandoverDraftSubmit input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Staff], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-submit", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Draft" || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_version_changed");
        await SubmitInspectedDraft(contract, prior, key, input, token);
        return await DraftView(contract, (await Drafts.GetAsync(id, token))!, token);
    }, token);

    public Task<HandoverDraftView> ResubmitHandoverDraftAsync(Guid id, HandoverDraftSubmit input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Staff], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-resubmit", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "ReinspectionRequested" || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_version_changed");
        await SubmitInspectedDraft(contract, prior, key, input, token, true);
        return await DraftView(contract, (await Drafts.GetAsync(id, token))!, token);
    }, token);

    private static void AddDraftEvidenceRequirements(HandoverDraftState state, List<string> missing)
    {
        if (state.EvidenceIds.Length == 0)
            missing.Add("room_summary_evidence");
        if ((state.RoomChecks ?? []).Any(check => check.Status != "NotApplicable" && check.EvidenceIds.Length == 0))
            missing.Add("room_check_evidence");
        if (state.KeyEvidenceIds is not { Length: > 0 })
            missing.Add("key_evidence");
    }

    private async Task SubmitInspectedDraft(Contract contract, HandoverDraftState prior,
        Guid key, HandoverDraftSubmit input, CancellationToken token, bool reinspection = false)
    {
        await RequireStartedMoveInWork(contract, token);
        if (prior.StaffPreparedBy != Actor || prior.StaffPreparedAt is null)
            throw ContractException.Conflict("handover_staff_inspection_required");
        var view = await DraftView(contract, prior, token);
        // Staff certifies that the four physical inspection sections were
        // recorded, including factual Missing/Damaged/Issue observations. The
        // Owner separately decides exceptions and validates the final PDF at
        // Ready. In particular, this step must not demand a second copy of the
        // already completed MoveInInventory observations in draft.assets.
        var missing = new List<string>();
        if (view.Electricity is null) missing.Add("electricity");
        if (view.Water is null) missing.Add("water");
        AddDraftEvidenceRequirements(prior, missing);
        try
        {
            var checks = HandoverRoomChecklist.Merge(null, prior.RoomChecks);
            var access = HandoverRoomChecklist.NormalizeAccess(prior.AccessItems);
            missing.AddRange(HandoverRoomChecklist.Missing(checks, access, prior.OutstandingIssues));
        }
        catch (ContractException)
        {
            missing.Add("room_checklist_or_keys");
        }
        if (view.MoveInTask?.InventoryTaskId is not null)
        {
            if (view.MoveInTask.InventoryStatus != "Completed" ||
                !await Handovers.InventoryReadyAsync(contract.Id, token))
                missing.Add("move_in_inventory");
        }
        else
        {
            // Legacy Main contracts may lack the separate inventory task.
            // Preserve their original Staff asset-inspection requirements;
            // only a completed canonical task replaces draft.assets as source.
            if (!view.NoAssetsConfirmed &&
                (view.Assets.Length == 0 || view.Assets.Any(asset => !asset.Checked ||
                    asset.EvidenceIds is not { Length: > 0 })))
                missing.Add("assets");
            else
            {
                try
                {
                    var inspected = HandoverChecklist.Inspect(view.Assets, prior.Assets,
                        handoverInventory is not null);
                    HandoverChecklist.RequireSeparateEvidence(view.EvidenceIds, inspected);
                }
                catch (ContractException) { missing.Add("asset_quantities_or_evidence"); }
            }
        }
        if (missing.Count != 0)
            throw ContractException.Conflict("handover_staff_sections_incomplete:" + string.Join(',', missing.Distinct()));
        // Every referenced Room/Issue/Key image must really belong to this
        // contract and still pass the private-storage integrity check. The
        // separate inventory task already verifies its own attached evidence.
        foreach (var evidenceId in prior.EvidenceIds
                     .Concat((prior.RoomChecks ?? []).SelectMany(check => check.EvidenceIds))
                     .Concat(prior.KeyEvidenceIds ?? [])
                     .Concat(view.MoveInTask?.InventoryTaskId is null
                         ? prior.Assets.SelectMany(asset => asset.EvidenceIds ?? []) : []).Distinct())
        {
            var file = await Workflow.FileAsync(contract.Id, evidenceId, token)
                ?? throw ContractException.Invalid("invalid_handover_evidence");
            if (file.Kind != ContractFileKind.HandoverEvidence)
                throw ContractException.Invalid("invalid_handover_evidence");
            await CopyVerifiedFile(file, Stream.Null, token);
        }
        if (reinspection)
        {
            if ((view.ReinspectionItems ?? []).Any(item => !item.Rechecked))
                throw ContractException.Conflict("handover_reinspection_incomplete");
        }
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "PendingOwnerReview",
            StaffSubmittedBy = Actor,
            StaffSubmittedAt = clock.GetUtcNow(),
            ReinspectionItems = (view.ReinspectionItems ?? []).Select(item => item with { Rechecked = true }).ToArray()
        };
        await Handovers.SubmitMoveInTaskAsync(contract.Id, Actor, clock.GetUtcNow(), token);
        await SaveDraftState(contract, prior, next, reinspection ? "StaffResubmitted" : "StaffSubmitted", token);
        Remember(key, reinspection ? "handover-draft-resubmit" : "handover-draft-submit",
            new { id = contract.Id, input }, contract.Id);
    }

    public Task<HandoverDraftView> RequestHandoverReinspectionAsync(Guid id,
        HandoverDraftReinspection input, Guid key, CancellationToken token) =>
        Mutate(id, [Roles.Owner], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-reinspection", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "PendingOwnerReview" || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_not_pending_owner_review");
        var reason = DraftText(input.Reason, 2000, true);
        var view = await DraftView(contract, prior, token);
        var items = ValidateReinspectionItems(input.Items, view);
        if ((prior.ReinspectionHistory ?? []).Length >= 30)
            throw ContractException.Conflict("handover_reinspection_limit");
        var history = new HandoverReinspectionRecord(prior.Version, reason, Actor, clock.GetUtcNow(), items);
        await Handovers.ReopenMoveInTaskAsync(id, Actor, clock.GetUtcNow(), token);
        // Only a selected asset needs the canonical inventory task reopened.
        // Staff rechecks through the existing task's versioned evidence and
        // item APIs; its historical Missing/Damaged observation is retained.
        if (items.Any(item => item.Kind == "Asset") &&
            view.MoveInTask?.InventoryTaskId is not null)
            await Handovers.ReopenMoveInInventoryAsync(id, Actor, clock.GetUtcNow(),
                items.Where(item => item.Kind == "Asset")
                    .Select(item => item.AssetId!.Value).ToArray(), token);
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "ReinspectionRequested",
            ReinspectionItems = items,
            ReinspectionHistory = [.. (prior.ReinspectionHistory ?? []), history],
            StaffSubmittedAt = null,
            StaffSubmittedBy = null,
            OwnerReadyBy = null,
            OwnerReadyAt = null,
            OwnerSignature = null,
            TenantSigning = null,
            TenantSignature = null
        };
        await SaveDraftState(contract, prior, next, "OwnerReinspectionRequested", token);
        Remember(key, "handover-draft-reinspection", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    private static HandoverReinspectionItem[] ValidateReinspectionItems(
        HandoverReinspectionItem[]? selected, HandoverDraftView view)
    {
        if (selected is not { Length: > 0 and <= 30 } || selected.Any(item => item is null))
            throw ContractException.Invalid("handover_reinspection_items_required");
        foreach (var item in selected)
        {
            var valid = item.Kind switch
            {
                "RoomCheck" => item.AssetId is null && item.Code is not null &&
                    HandoverRoomChecklist.RequiredCodes.Contains(item.Code),
                "Asset" => item.AssetId is not null && item.Code is null &&
                    (view.InspectedAssets?.Any(asset => asset.Id == item.AssetId) == true ||
                     view.InspectedAssets is null && view.Assets.Any(asset => asset.Id == item.AssetId)),
                "Access" => item.AssetId is null && item.Code == "RoomKey",
                // Re-capturing an immutable Initial meter reading needs a
                // separate evidence/confirmation API and agreed correction
                // policy. Avoid creating a reinspection task Staff cannot close.
                "Meter" => false,
                "Room" => item.AssetId is null && item.Code is null,
                _ => false
            };
            if (!valid || item.Rechecked || item.ReadingId is not null)
                throw ContractException.Invalid("invalid_handover_reinspection_item");
        }
        if (selected.DistinctBy(item => (item.Kind, item.Code, item.AssetId)).Count() != selected.Length)
            throw ContractException.Invalid("duplicate_handover_reinspection_item");
        return selected.Select(item => item with
        {
            ReadingId = item.Kind == "Meter" ? item.Code == "Electricity" ?
                view.Electricity?.Id : view.Water?.Id : null
        }).ToArray();
    }

    public Task<HandoverDraftView> ReadyHandoverDraftAsync(Guid id, HandoverDraftReady input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Owner], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-ready", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "PendingOwnerReview" || prior.Version != input.Version ||
            prior.StaffSubmittedAt is null || prior.StaffSubmittedBy is null)
            throw ContractException.Conflict("handover_draft_version_changed");
        var view = await DraftView(contract, prior, token);
        if (view.Missing.Length != 0) throw ContractException.Conflict("handover_draft_incomplete:" + string.Join(',', view.Missing));
        if (!await Handovers.InventoryReadyAsync(id, token))
            throw ContractException.Conflict("move_in_inventory_required");
        var inspected = ReadyAssets(view, prior.Assets, handoverInventory is not null);
        HandoverChecklist.RequireSeparateEvidence(view.EvidenceIds, inspected);
        var snapshot = DraftSnapshot(contract, view, inspected, null);
        if (view.AccessItems is not { Length: 1 })
            throw ContractException.Conflict("handover_access_inventory_required");
        var reason = DraftText(input.Reason ?? "", 2000);
        var handlingPlan = DraftText(input.HandlingPlan ?? "", 2000);
        await ValidateHandoverEvidence(contract, snapshot, token);
        var signature = await SignOwnerHandoverAsync(contract,
            view with { OwnerReadyReason = reason, OwnerHandlingPlan = handlingPlan },
            input.Signature, input.Ink, token);
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "Ready",
            OwnerReadyBy = Actor,
            OwnerReadyAt = signature.SignedAt,
            ApprovedElectricityReadingId = view.Electricity!.Id,
            ApprovedWaterReadingId = view.Water!.Id,
            OwnerReadyReason = reason,
            OwnerHandlingPlan = handlingPlan,
            OwnerSignature = signature,
            TenantSigning = null,
            TenantSignature = null
        };
        await SaveDraftState(contract, prior, next, "OwnerReady", token);
        Remember(key, "handover-draft-ready", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    private static HandoverAsset[] ReadyAssets(HandoverDraftView view,
        HandoverAssetInput[] legacyDraftAssets, bool quantitiesRequired)
    {
        if (view.InspectedAssets is not { } canonical)
            return HandoverChecklist.Inspect(view.Assets, legacyDraftAssets, quantitiesRequired);
        if (canonical.Length != view.Assets.Length ||
            canonical.Select(asset => asset.Id).Distinct().Count() != canonical.Length)
            throw ContractException.Conflict("handover_asset_inventory_changed");
        var source = view.Assets.ToDictionary(asset => asset.Id);
        return canonical.Select(observation =>
        {
            if (!source.TryGetValue(observation.Id, out var asset) ||
                (asset.ConfiguredQuantity is { } expected && expected != observation.ExpectedQuantity))
                throw ContractException.Conflict("handover_inventory_not_passed");
            // Preserve observed defects and actual handed-over quantities.
            return asset with
            {
                ObservedCondition = observation.Condition,
                ObservedQuantity = observation.ActualQuantity,
                HandedOverQuantity = observation.ActualQuantity,
                GoodQuantity = observation.Condition == "Good" ? observation.ActualQuantity : 0,
                WornQuantity = 0,
                DamagedQuantity = observation.Condition == "Damaged" ? observation.ActualQuantity : 0,
                MissingQuantity = Math.Max(0, observation.ExpectedQuantity - observation.ActualQuantity),
                Checked = true,
                OwnerChecked = true,
                Notes = observation.Notes,
                EvidenceIds = []
            };
        }).ToArray();
    }

    private static HandoverSnapshot DraftSnapshot(Contract contract, HandoverDraftView view,
        HandoverAsset[] assets, HandoverOwnerAcceptance? acceptance) =>
        new(view.Electricity!.Date, contract.Room.RoomNumber, view.RoomCondition,
            view.KeysAndAccess, view.Notes, assets, view.Electricity!, view.Water!, view.EvidenceIds,
            view.InventoryToken, null, view.NoAssetsConfirmed, acceptance)
        {
            RoomChecks = view.RoomChecks ?? [],
            AccessItems = view.AccessItems ?? [],
            OutstandingIssues = view.OutstandingIssues ?? [],
            KeyEvidenceIds = view.KeyEvidenceIds ?? []
        };

    public Task<HandoverDraftView> RequestHandoverDraftChangeAsync(Guid id, HandoverDraftCorrection input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Tenant], async contract =>
    {
        RequireMainHandover(contract);
        if (contract.TenantUserId != Actor) throw new ContractException(403, "contract_tenant_required");
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-request", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Ready" || input.Version != prior.Version ||
            prior.Requests.Any(r => r.Status == "Pending") || prior.Requests.Length >= 100)
            throw ContractException.Conflict("handover_draft_not_ready_for_change");
        var reason = DraftText(input.Reason, 2000, required: true);
        var request = new HandoverDraftRequest(Guid.NewGuid(), prior.Version, reason,
            "Pending", clock.GetUtcNow());
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "ChangesRequested",
            Requests = [.. prior.Requests, request],
            OwnerReadyAt = null,
            OwnerReadyBy = null,
            TenantSigning = null
        };
        await SaveDraftState(contract, prior, next, "TenantChangeRequested", token);
        Remember(key, "handover-draft-request", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    public Task<HandoverDraftView> DecideHandoverDraftChangeAsync(Guid id, Guid requestId,
        HandoverDraftCorrectionDecision input, Guid key, CancellationToken token) =>
        Mutate(id, [Roles.Owner], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-decision", new { id, requestId, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "ChangesRequested" || prior.Version != input.Version ||
            prior.Requests.Count(r => r.Id == requestId && r.Status == "Pending") != 1)
            throw ContractException.Conflict("handover_draft_request_changed");
        var reason = DraftText(input.Reason, 2000, required: true);
        var current = await DraftView(contract, prior, token);
        // An Owner rejection cannot silently re-enable Tenant acceptance of a
        // baseline that changed while the request was under review.
        var mustReviewAgain = current.Missing.Length != 0 ||
            current.Electricity?.Id != prior.ApprovedElectricityReadingId ||
            current.Water?.Id != prior.ApprovedWaterReadingId;
        var reopen = input.Accepted || mustReviewAgain;
        if (reopen && prior.StaffSubmittedAt is not null)
            await Handovers.ReopenMoveInTaskAsync(id, Actor, clock.GetUtcNow(), token);
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = reopen ? "Draft" : "Ready",
            OwnerReadyBy = reopen ? null : Actor,
            OwnerReadyAt = reopen ? null : prior.OwnerSignature?.SignedAt ?? clock.GetUtcNow(),
            OwnerSignature = reopen ? null : prior.OwnerSignature,
            TenantSigning = null,
            TenantSignature = null,
            StaffSubmittedAt = reopen ? null : prior.StaffSubmittedAt,
            StaffSubmittedBy = reopen ? null : prior.StaffSubmittedBy,
            Requests = prior.Requests.Select(r => r.Id != requestId ? r : r with
            {
                Status = input.Accepted ? "Approved" : "Rejected",
                DecisionReason = reason,
                ReviewedBy = Actor,
                ReviewedAt = clock.GetUtcNow()
            }).ToArray()
        };
        await SaveDraftState(contract, prior, next, input.Accepted ? "ChangeAccepted" : "ChangeRejected", token);
        Remember(key, "handover-draft-decision", new { id, requestId, input }, id);
        return await DraftView(contract, next, token);
    }, token);

}
