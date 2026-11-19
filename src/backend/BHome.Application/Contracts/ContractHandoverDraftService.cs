using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IHandoverDraftRepository Drafts => handoverDrafts ?? throw new ContractException(503, "handover_draft_unavailable");

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
        var task = await Handovers.MoveInTaskAsync(contract.Id, contract.RoomId, Actor, token);
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

    private async Task<HandoverDraftView> DraftView(Contract contract, HandoverDraftState state, CancellationToken token)
    {
        var moveInTask = await Handovers.MoveInTaskAsync(contract.Id, contract.RoomId,
            user.IsInRole(Roles.Staff) ? Actor : null, token);
        var readings = await Handovers.ReadingsAsync(contract.Id, contract.RoomId, contract.StartDate, token);
        var electricity = readings.Where(r => r.UtilityType == 0).OrderByDescending(r => r.Date).ThenBy(r => r.Id).FirstOrDefault();
        var water = readings.Where(r => r.UtilityType == 1).OrderByDescending(r => r.Date).ThenBy(r => r.Id).FirstOrDefault();
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareForContractAsync(
            contract.RoomId, contract.TenantUserId, token);
        var source = inventory?.Groups ?? (await Handovers.AssetsAsync(contract.RoomId, token))
            .Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray();
        var assets = source.Select(a => WithDraftObservations(a, state.Assets.SingleOrDefault(s => s.Id == a.Id))).ToArray();
        var missing = new List<string>();
        if (contract.Status != ContractStatus.Active) missing.Add("contract_active");
        if (contract.TenantUserId is null) missing.Add("tenant_account");
        if (electricity is null) missing.Add("electricity");
        if (water is null) missing.Add("water");
        if (electricity is not null && water is not null && electricity.Date != water.Date)
            missing.Add("meter_readings_same_day");
        if (string.IsNullOrWhiteSpace(state.RoomCondition)) missing.Add("room_condition");
        if (string.IsNullOrWhiteSpace(state.KeysAndAccess)) missing.Add("keys_and_access");
        if (state.EvidenceIds.Length == 0) missing.Add("room_evidence");
        missing.AddRange(HandoverRoomChecklist.Missing(state.RoomChecks, state.AccessItems, state.OutstandingIssues));
        if (inventory is { Groups.Length: 0, NoAssetsConfirmed: false } ||
            source.Length != state.Assets.Length || assets.Any(a => !a.Checked)) missing.Add("assets");
        else
        {
            try
            {
                var inspected = HandoverChecklist.Inspect(source, state.Assets, inventory is not null);
                HandoverChecklist.RequireSeparateEvidence(state.EvidenceIds, inspected);
            }
            catch (ContractException)
            {
                // Do not report a fully complete checklist for Staff inputs
                // whose quantities/physical mapping/evidence would fail Ready.
                missing.Add("asset_quantities_or_evidence");
            }
        }
        if (inventory is not null && state.InventoryToken != inventory.StateToken) missing.Add("inventory_changed");
        if (state.StaffPreparedBy is null) missing.Add("staff_inspection");
        if (state.Status == "Draft" && state.StaffPreparedBy is null && moveInTask?.CanInspect != true &&
            user.IsInRole(Roles.Staff)) missing.Add("move_in_task_not_started");
        if (state.ContractSnapshotHash != contract.SnapshotHash) missing.Add("contract_changed");
        return new(state.Version, state.Status, contract.Id, contract.Room.RoomNumber,
            contract.Room.Location.Name, contract.Room.Location.Address,
            contract.StartDate, contract.EndDate, contract.MonthlyRent, contract.RequiredDeposit,
            contract.Terms, electricity, water, assets, state.RoomCondition, state.KeysAndAccess,
            state.Notes, state.EvidenceIds, inventory?.StateToken, inventory?.NoAssetsConfirmed ?? false,
            state.OwnerReadyAt, state.TenantConfirmedAt, state.Requests, missing.Distinct().ToArray(),
            state.RoomChecks ?? [], state.AccessItems ?? [], state.OutstandingIssues ?? [], moveInTask);
    }

    public async Task<HandoverDraftView> GetHandoverDraftAsync(Guid id, CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        RequireMainHandover(contract);
        var state = await DraftState(contract, token);
        return await DraftView(contract, state, token);
    }

    public Task<HandoverDraftView> SaveHandoverDraftAsync(Guid id, HandoverDraftWrite input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Staff], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-write", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Draft" || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_version_changed");
        await RequireStartedMoveInWork(contract, token);
        if (input.Assets is { Length: > 200 } || input.EvidenceIds is { Length: > 10 } ||
            input.Assets?.Any(a => a is null) == true || input.EvidenceIds is { } ids &&
                (ids.Contains(Guid.Empty) || ids.Distinct().Count() != ids.Length))
            throw ContractException.Invalid("invalid_handover_draft_input");
        var roomChecks = HandoverRoomChecklist.Merge(prior.RoomChecks, input.RoomChecks);
        var accessItems = input.AccessItems is null
            ? prior.AccessItems ?? [] : HandoverRoomChecklist.NormalizeAccess(input.AccessItems);
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
            // Saving one completed inspection must not erase other asset groups.
            // Staff may return multiple times and each checked group fills the
            // corresponding section of the same evolving draft.
            assets = source.Select(a => input.Assets.SingleOrDefault(i => i.Id == a.Id) ??
                prior.Assets.SingleOrDefault(i => i.Id == a.Id))
                .OfType<HandoverAssetInput>().ToArray();
            inventoryToken = inventory?.StateToken;
        }
        var next = prior with
        {
            Version = prior.Version + 1,
            ContractSnapshotHash = contract.SnapshotHash,
            RoomCondition = input.RoomCondition is null ? prior.RoomCondition : DraftText(input.RoomCondition, 2000),
            KeysAndAccess = input.KeysAndAccess is null ? prior.KeysAndAccess : DraftText(input.KeysAndAccess, 2000),
            Notes = input.Notes is null ? prior.Notes : DraftText(input.Notes, 4000),
            Assets = assets,
            EvidenceIds = input.EvidenceIds ?? prior.EvidenceIds,
            RoomChecks = roomChecks,
            AccessItems = accessItems,
            OutstandingIssues = [],
            InventoryToken = inventoryToken,
            StaffPreparedBy = Actor,
            StaffPreparedAt = clock.GetUtcNow(),
            OwnerReadyBy = null,
            OwnerReadyAt = null
        };
        await SaveDraftState(contract, prior, next, "Updated", token);
        Remember(key, "handover-draft-write", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    public Task<HandoverDraftView> ReadyHandoverDraftAsync(Guid id, HandoverDraftReady input,
        Guid key, CancellationToken token) => Mutate(id, [Roles.Owner], async contract =>
    {
        RequireMainHandover(contract);
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-ready", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Draft" || prior.Version != input.Version)
            throw ContractException.Conflict("handover_draft_version_changed");
        var view = await DraftView(contract, prior, token);
        if (view.Missing.Length != 0) throw ContractException.Conflict("handover_draft_incomplete:" + string.Join(',', view.Missing));
        var inspected = HandoverChecklist.Inspect(view.Assets,
            prior.Assets, handoverInventory is not null);
        HandoverChecklist.RequireSeparateEvidence(view.EvidenceIds, inspected);
        var snapshot = DraftSnapshot(contract, view, inspected, null);
        // Missing, damaged or unverified inventory requires an explicit Owner
        // decision, matching the existing signed handover exception policy.
        var exception = HandoverChecklist.RequiresOwner(snapshot) ||
            (view.RoomChecks ?? []).Any(check => check.Status == "Issue");
        var reason = DraftText(input.Reason ?? "", 2000, required: exception);
        var handlingPlan = DraftText(input.HandlingPlan ?? "", 2000, required: exception);
        await ValidateHandoverEvidence(contract, snapshot, token);
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "Ready",
            OwnerReadyBy = Actor,
            OwnerReadyAt = clock.GetUtcNow(),
            ApprovedElectricityReadingId = view.Electricity!.Id,
            ApprovedWaterReadingId = view.Water!.Id,
            OwnerReadyReason = reason,
            OwnerHandlingPlan = handlingPlan
        };
        await SaveDraftState(contract, prior, next, "OwnerReady", token);
        Remember(key, "handover-draft-ready", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    private static HandoverSnapshot DraftSnapshot(Contract contract, HandoverDraftView view,
        HandoverAsset[] assets, HandoverOwnerAcceptance? acceptance) =>
        new(view.Electricity!.Date, contract.Room.RoomNumber, view.RoomCondition,
            view.KeysAndAccess, view.Notes, assets, view.Electricity!, view.Water!, view.EvidenceIds,
            view.InventoryToken, null, view.NoAssetsConfirmed, acceptance)
        {
            RoomChecks = view.RoomChecks ?? [],
            AccessItems = view.AccessItems ?? [],
            OutstandingIssues = view.OutstandingIssues ?? []
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
            OwnerReadyBy = null
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
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = reopen ? "Draft" : "Ready",
            OwnerReadyBy = reopen ? null : Actor,
            OwnerReadyAt = reopen ? null : clock.GetUtcNow(),
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

    public Task<HandoverDraftView> ConfirmHandoverDraftAsync(Guid id,
        HandoverDraftTenantConfirmation input, Guid key, CancellationToken token) =>
        Mutate(id, [Roles.Tenant], async contract =>
    {
        RequireMainHandover(contract);
        if (contract.TenantUserId != Actor) throw new ContractException(403, "contract_tenant_required");
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-draft-tenant-confirm", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Ready" || prior.OwnerReadyAt is null || prior.OwnerReadyBy is null ||
            prior.StaffPreparedBy is null || prior.StaffPreparedAt is null || prior.Version != input.Version ||
            prior.Requests.Any(r => r.Status == "Pending"))
            throw ContractException.Conflict("owner_ready_handover_required");
        var view = await DraftView(contract, prior, token);
        if (view.Missing.Length != 0) throw ContractException.Conflict("handover_draft_changed_since_review");
        if (view.Electricity?.Id != prior.ApprovedElectricityReadingId ||
            view.Water?.Id != prior.ApprovedWaterReadingId)
            throw ContractException.Conflict("handover_meter_readings_changed_since_owner_review");
        var assets = HandoverChecklist.Inspect(view.Assets, prior.Assets, handoverInventory is not null);
        HandoverChecklist.RequireSeparateEvidence(view.EvidenceIds, assets);
        if ((HandoverChecklist.RequiresOwner(DraftSnapshot(contract, view, assets, null)) ||
            (view.RoomChecks ?? []).Any(check => check.Status == "Issue")) &&
            (string.IsNullOrWhiteSpace(prior.OwnerReadyReason) ||
                string.IsNullOrWhiteSpace(prior.OwnerHandlingPlan)))
            throw ContractException.Conflict("owner_exception_decision_required");
        var h = await Handovers.GetAsync(id, token);
        if (h?.Status == ContractHandoverStatus.Confirmed)
            throw ContractException.Conflict("handover_already_confirmed");
        if (h is null) { h = new ContractHandover { ContractId = id }; repository.Add(h); }
        else h.Version++;
        var approvalReason = string.IsNullOrWhiteSpace(prior.OwnerReadyReason)
            ? "Owner đã duyệt sẵn sàng bàn giao" : prior.OwnerReadyReason;
        var approvalPlan = string.IsNullOrWhiteSpace(prior.OwnerHandlingPlan)
            ? "Không ghi nhận ngoại lệ cần xử lý" : prior.OwnerHandlingPlan;
        var acceptance = new HandoverOwnerAcceptance(h.Version, prior.OwnerReadyBy.Value, prior.OwnerReadyAt.Value,
            approvalReason, approvalPlan);
        // This is an app-level Tenant acknowledgement, NOT a digital signature.
        // Persist the actor, timestamp and optional note in the immutable PDF
        // snapshot so its meaning remains verifiable after later changes.
        var feedback = new HandoverFeedback(Actor, clock.GetUtcNow(), true,
            DraftText(input.Note ?? "", 2000));
        var snapshot = DraftSnapshot(contract, view, assets, acceptance) with { TenantFeedback = feedback };
        await ValidateHandoverEvidence(contract, snapshot, token);
        // Preserve the pre-existing move-out baseline and PDF pipeline unchanged.
        h.Snapshot = JsonSerializer.Serialize(snapshot); h.Status = ContractHandoverStatus.Confirmed;
        h.ElectricityReadingId = view.Electricity!.Id; h.WaterReadingId = view.Water!.Id;
        h.TenantConfirmedVersion = h.Version; h.TenantConfirmedBy = Actor;
        h.TenantConfirmedAt = feedback.At; h.StaffConfirmedBy = prior.StaffPreparedBy;
        h.StaffConfirmedAt = prior.StaffPreparedAt;
        HandoverEvent(h, "Completed", "Owner reviewed and Tenant confirmed without digital signature");
        await Handovers.CompleteMoveInTaskAsync(id, prior.StaffPreparedBy.Value, clock.GetUtcNow(), token);
        // The final PDF is immutable, so include the Tenant's requests and each
        // recorded Owner decision at the moment of completion as an audit trail.
        if (handoverDocuments is not null)
        {
            var corrections = prior.Requests.OrderBy(request => request.CreatedAt)
                .Select(request => $"Yêu cầu chỉnh sửa {request.CreatedAt:O}: {request.Reason}. " +
                    $"Quyết định Owner: {request.Status}. {request.DecisionReason ?? ""}").ToArray();
            await PersistHandoverDocument(contract, h, token, corrections);
        }
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "Confirmed",
            TenantConfirmedBy = Actor,
            TenantConfirmedAt = h.TenantConfirmedAt
        };
        await SaveDraftState(contract, prior, next, "TenantConfirmed", token);
        Remember(key, "handover-draft-tenant-confirm", new { id, input }, id);
        return await DraftView(contract, next, token);
    }, token);

    public async Task<byte[]> HandoverDraftPdfAsync(Guid id, CancellationToken token)
    {
        var view = await GetHandoverDraftAsync(id, token);
        return await (handoverDraftPdf ?? throw new ContractException(503, "handover_draft_template_unavailable"))
            .RenderDraftAsync(view, token);
    }

    public async Task CopyHandoverDraftEvidenceAsync(Guid id, Guid fileId,
        Stream output, CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        RequireMainHandover(contract);
        var state = await DraftState(contract, token);
        // A stored draft reference is mandatory; guessing a private file ID
        // must not reveal another Tenant's or another draft's uploads.
        if (!state.EvidenceIds.Contains(fileId) &&
            !state.Assets.Any(a => a.EvidenceIds?.Contains(fileId) == true) &&
            !(state.RoomChecks ?? []).Any(check => check.EvidenceIds.Contains(fileId)))
            throw ContractException.Missing();
        var file = await Workflow.FileAsync(id, fileId, token) ?? throw ContractException.Missing();
        if (file.Kind != ContractFileKind.HandoverEvidence)
            throw ContractException.Missing();
        await CopyVerifiedFile(file, output, token);
    }

    public async Task<ContractId> UploadHandoverDraftEvidenceAsync(Guid id, Stream input, CancellationToken token)
    {
        Role(Roles.Staff);
        var contract = await Load(id, [Roles.Staff], token);
        RequireMainHandover(contract);
        var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var count = await input.ReadAsync(block, token);
            if (count == 0) break;
            if (buffer.Length + count > 5 * 1024 * 1024)
                throw new ContractException(413, "inspection_image_too_large");
            await buffer.WriteAsync(block.AsMemory(0, count), token);
        }
        var bytes = buffer.ToArray();
        var contentType = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async current =>
        {
            RequireMainHandover(current);
            var draft = await DraftState(current, token);
            if (draft.Status != "Draft") throw ContractException.Conflict("handover_draft_not_editable");
            await RequireStartedMoveInWork(current, token);
            if ((await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, token)).Count >= 200)
                throw ContractException.Conflict("handover_evidence_limit");
            var file = new ContractDocumentFile
            {
                ContractId = id,
                Kind = ContractFileKind.HandoverEvidence,
                SnapshotHash = current.SnapshotHash,
                DevelopmentOnly = current.IsDevelopmentDemo,
                ContentType = contentType,
                Length = bytes.Length,
                FileHash = FileHash(bytes),
                RecordedByUserId = Actor,
                RecordedAt = clock.GetUtcNow()
            };
            file.ObjectKey = $"contracts/{id:N}/handover/{file.Id:N}";
            await files.PutAsync(current.RoomId, file.ObjectKey, bytes, contentType, token);
            repository.Add(file);
            Audit("ContractHandoverDraftEvidenceAdded", id);
            return new ContractId(file.Id);
        }, token);
    }
}
