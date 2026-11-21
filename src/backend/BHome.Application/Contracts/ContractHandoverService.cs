using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IContractHandoverRepository Handovers => handoverRepository ?? throw new ContractException(503, "handover_unavailable");
    private static HandoverSnapshot Snapshot(ContractHandover h) => JsonSerializer.Deserialize<HandoverSnapshot>(h.Snapshot) ?? throw ContractException.Conflict("handover_integrity_failed");
    private static HandoverView HandoverView(ContractHandover h) => new(h.Version, h.Status.ToString(), Snapshot(h), h.TenantConfirmedVersion, h.TenantConfirmedAt, h.StaffConfirmedAt);
    private void HandoverEvent(ContractHandover h, string action, string note = "")
    {
        repository.Add(new ContractHandoverHistory { ContractId = h.ContractId, Version = h.Version, Action = action, ActorId = Actor, OccurredAt = clock.GetUtcNow(), Snapshot = h.Snapshot, Note = note, ElectricityReadingId = h.ElectricityReadingId, WaterReadingId = h.WaterReadingId });
        Audit("ContractHandover" + action, h.ContractId);
    }
    private static void HandoverActive(Contract c)
    { if (c.Status != ContractStatus.Active || c.Kind is not (ContractKind.Main or ContractKind.Renewal)) throw ContractException.Conflict("active_main_contract_required"); }
    private static string HandoverText(string? value, int max, bool required = true)
    { var text = value?.Trim() ?? ""; if (text.Length > max || required && text.Length == 0) throw ContractException.Invalid("invalid_handover_input"); return text; }

    public async Task<HandoverView> GetHandoverAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var current = await Handovers.GetAsync(id, t);
        if (current is not null) return HandoverView(current) with { SourceContractId = id };
        var (root, inherited) = await Baseline(c, t);
        return HandoverView(inherited ?? throw ContractException.Missing()) with { SourceContractId = root.Id };
    }
    public async Task<IReadOnlyList<HandoverHistoryView>> HandoverHistoryAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        if (contract.PreviousContractId is not null && await Handovers.GetAsync(id, t) is null) id = (await Baseline(contract, t)).Contract.Id;
        return (await Handovers.HistoryAsync(id, t)).Select(h => new HandoverHistoryView(h.Version, h.Action, h.ActorId, h.OccurredAt, h.Note,
            JsonSerializer.Deserialize<HandoverSnapshot>(h.Snapshot) ?? throw ContractException.Conflict("handover_integrity_failed"))).ToArray();
    }
    public async Task<HandoverChoices> HandoverChoicesAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Staff], t); HandoverActive(c);
        if (handoverInventory is not null)
        {
            var inventory = await handoverInventory.PrepareAsync(c.RoomId, t);
            return new(inventory.Groups, await Handovers.ReadingsAsync(c.Id, c.RoomId, c.StartDate, t),
                (await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, t)).Select(DocumentView).ToArray(),
                inventory.StateToken, inventory.State, inventory.NoAssetsConfirmed);
        }
        return new((await Handovers.AssetsAsync(c.RoomId, t)).Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray(),
            await Handovers.ReadingsAsync(c.Id, c.RoomId, c.StartDate, t), (await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, t)).Select(DocumentView).ToArray());
    }
    private async Task ValidateHandoverEvidence(Contract c, HandoverSnapshot snapshot, CancellationToken t, bool existingSnapshot = false)
    {
        var readings = await Handovers.ReadingsAsync(c.Id, c.RoomId, c.StartDate, t);
        foreach (var reading in new[] { snapshot.Electricity, snapshot.Water })
        {
            var current = readings.SingleOrDefault(r => r.Id == reading.Id && r.Date == snapshot.Date && r.UtilityType == reading.UtilityType && r.Value == reading.Value && r.EvidenceHash == reading.EvidenceHash);
            if (current is null && existingSnapshot)
            {
                // Preserve already-recorded handovers created before the
                // contract-specific Initial task rule. This is ONLY called for
                // Staff confirmation of an existing immutable snapshot; new
                // SaveHandover requests may never select another tenant's photo.
                var historical = await Handovers.ReadingAsync(c.RoomId, reading.Id, t);
                if (historical is not null && historical.Date == snapshot.Date && historical.UtilityType == reading.UtilityType &&
                    historical.Value == reading.Value && historical.EvidenceHash == reading.EvidenceHash)
                    current = historical;
            }
            if (current is null) throw ContractException.Invalid("confirmed_handover_readings_required");
            using var image = new MemoryStream(); await storage.CopyToAsync(current.EvidenceObjectKey, image, t);
            if (FileHash(image.ToArray()) != current.EvidenceHash) throw ContractException.Conflict("handover_evidence_integrity_failed");
        }
        foreach (var evidenceId in snapshot.EvidenceIds.Concat(snapshot.Assets.SelectMany(a => a.EvidenceIds ?? []))
                     .Concat((snapshot.RoomChecks ?? []).SelectMany(check => check.EvidenceIds))
                     .Concat(snapshot.KeyEvidenceIds ?? []).Distinct())
        {
            var f = await Workflow.FileAsync(c.Id, evidenceId, t) ?? throw ContractException.Invalid("invalid_handover_evidence");
            if (f.Kind != ContractFileKind.HandoverEvidence) throw ContractException.Invalid("invalid_handover_evidence");
            await CopyVerifiedFile(f, Stream.Null, t);
        }
    }
    public Task<HandoverView> SaveHandoverAsync(Guid id, HandoverInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Staff], async c =>
    {
        HandoverActive(c);
        await RequireLegacyHandoverCompatibility(c, t);
        if (c.PreviousContractId is not null && (await Baseline(c, t)).Handover is not null) throw ContractException.Conflict("renewal_inherits_handover_baseline");
        var h = await Handovers.GetAsync(id, t);
        if (await Replay(key, "handover-save", new { id, x }, t) is not null) return HandoverView(h ?? throw ContractException.Missing());
        if (h?.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_already_confirmed");
        if (x.Version != (h?.Version ?? 0)) throw ContractException.Conflict("handover_version_changed");
        if (x.Date < c.StartDate || x.Date > Today || x.Date > c.EndDate || x.Assets is null || x.Assets.Length > 200 || x.Assets.Any(a => a is null) || x.EvidenceIds is null ||
            x.EvidenceIds.Length is < 1 or > 10 || x.EvidenceIds.Distinct().Count() != x.EvidenceIds.Length || x.Assets.Select(a => a.Id).Distinct().Count() != x.Assets.Length)
            throw ContractException.Invalid("invalid_handover_input");
        var inventory = handoverInventory is null ? null : await handoverInventory.PrepareAsync(c.RoomId, t);
        if (inventory is not null && inventory.StateToken != x.InventoryToken) throw ContractException.Conflict("handover_asset_inventory_changed");
        if (inventory is { Groups.Length: 0, NoAssetsConfirmed: false }) throw ContractException.Conflict("owner_no_assets_confirmation_required");
        var assets = inventory?.Groups ?? (await Handovers.AssetsAsync(c.RoomId, t)).Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray();
        var inspected = HandoverChecklist.Inspect(assets, x.Assets, inventory is not null);
        HandoverChecklist.RequireSeparateEvidence(x.EvidenceIds, inspected);
        var readings = await Handovers.ReadingsAsync(c.Id, c.RoomId, c.StartDate, t);
        var electricity = readings.SingleOrDefault(r => r.Id == x.ElectricityReadingId && r.UtilityType == 0 && r.Date == x.Date);
        var water = readings.SingleOrDefault(r => r.Id == x.WaterReadingId && r.UtilityType == 1 && r.Date == x.Date);
        if (electricity is null || water is null) throw ContractException.Invalid("confirmed_handover_readings_required");
        var snapshot = new HandoverSnapshot(x.Date, c.Room.RoomNumber, HandoverText(x.RoomCondition, 2000), HandoverText(x.KeysAndAccess, 2000), HandoverText(x.Notes, 4000, false),
            inspected, electricity, water, x.EvidenceIds, inventory?.StateToken, inventory?.State, inventory?.NoAssetsConfirmed ?? false);
        await ValidateHandoverEvidence(c, snapshot, t);
        if (h is null) { h = new ContractHandover { ContractId = id }; repository.Add(h); } else h.Version++;
        h.Snapshot = JsonSerializer.Serialize(snapshot); h.Status = ContractHandoverStatus.Draft;
        h.ElectricityReadingId = electricity.Id; h.WaterReadingId = water.Id;
        h.TenantConfirmedVersion = null; h.TenantConfirmedAt = null; h.TenantConfirmedBy = null;
        if (handoverInventory is not null && inspected.Any(HandoverChecklist.Problem))
            await handoverInventory.MarkForReviewAsync(c.RoomId, id, h.Version, Actor, t);
        HandoverEvent(h, "Recorded");
        await Handovers.NotifyAsync(c, "HandoverAwaitingTenant", Actor, h.Version, t);
        Remember(key, "handover-save", new { id, x }, id); return HandoverView(h);
    }, t);
    public Task<HandoverView> ReviewHandoverAsync(Guid id, HandoverOwnerReview x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        HandoverActive(c); await RequireLegacyHandoverCompatibility(c, t);
        var h = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "handover-owner-review", new { id, x }, t) is not null) return HandoverView(h);
        if (h.Version != x.Version || h.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_version_changed");
        var reason = HandoverText(x.Reason, 2000); var plan = HandoverText(x.HandlingPlan, 2000);
        var snapshot = Snapshot(h);
        if (handoverInventory is not null && (await handoverInventory.PrepareAsync(c.RoomId, t)).StateToken != snapshot.InventoryToken)
            throw ContractException.Conflict("handover_asset_inventory_changed");
        h.Version++;
        h.Snapshot = JsonSerializer.Serialize(snapshot with { OwnerAcceptance = x.Accepted ? new(h.Version, Actor, clock.GetUtcNow(), reason, plan) : null });
        h.Status = x.Accepted ? ContractHandoverStatus.Draft : ContractHandoverStatus.Disputed;
        h.TenantConfirmedVersion = null; h.TenantConfirmedAt = null; h.TenantConfirmedBy = null;
        HandoverEvent(h, x.Accepted ? "OwnerExceptionApproved" : "OwnerReinspectionRequested", reason + "\n" + plan);
        await Handovers.NotifyAsync(c, "HandoverOwnerReviewed", Actor, h.Version, t);
        Remember(key, "handover-owner-review", new { id, x }, id); return HandoverView(h);
    }, t);
    public Task<HandoverView> DecideHandoverAsync(Guid id, HandoverDecision x, Guid key, bool dispute, bool staff, CancellationToken t) => Mutate(id, staff ? [Roles.Staff] : [Roles.Tenant], async c =>
    {
        HandoverActive(c); await RequireLegacyHandoverCompatibility(c, t);
        var h = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        var operation = staff ? "handover-staff" : dispute ? "handover-dispute" : "handover-tenant";
        if (await Replay(key, operation, new { id, x }, t) is not null) return HandoverView(h);
        if (h.Version != x.Version) throw ContractException.Conflict("handover_version_changed");
        if (h.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_already_confirmed");
        var note = HandoverText(x.Note, 2000, dispute);
        if (staff)
        {
            if (h.TenantConfirmedVersion != h.Version || h.Status != ContractHandoverStatus.Draft) throw ContractException.Conflict("tenant_handover_confirmation_required");
            if (!await Handovers.InventoryReadyAsync(id, t)) throw ContractException.Conflict("move_in_inventory_required");
            var snapshot = Snapshot(h);
            if (handoverInventory is not null)
            {
                if ((await handoverInventory.PrepareAsync(c.RoomId, t)).StateToken != snapshot.InventoryToken) throw ContractException.Conflict("handover_asset_inventory_changed");
                if (snapshot.Assets.Any(a => !a.Checked)) throw ContractException.Conflict("handover_checklist_incomplete");
                if (HandoverChecklist.RequiresOwner(snapshot) && snapshot.OwnerAcceptance?.Version != h.Version)
                    throw ContractException.Conflict("owner_handover_exception_required");
            }
            await ValidateHandoverEvidence(c, snapshot, t, existingSnapshot: true);
            h.StaffConfirmedBy = Actor; h.StaffConfirmedAt = clock.GetUtcNow(); h.Status = ContractHandoverStatus.Confirmed;
            await Handovers.CompleteMoveInTaskAsync(id, Actor, clock.GetUtcNow(), t);
            if (handoverDocuments is not null) await PersistHandoverDocument(c, h, t);
        }
        else
        {
            if (Actor != c.TenantUserId) throw new ContractException(403, "contract_tenant_required");
            if (!dispute && h.Status == ContractHandoverStatus.Disputed) throw ContractException.Conflict("handover_correction_required");
            h.TenantConfirmedVersion = dispute ? null : h.Version; h.TenantConfirmedAt = dispute ? null : clock.GetUtcNow(); h.TenantConfirmedBy = dispute ? null : Actor;
            h.Status = dispute ? ContractHandoverStatus.Disputed : ContractHandoverStatus.Draft;
        }
        HandoverEvent(h, staff ? "Completed" : dispute ? "Disputed" : "TenantConfirmed", note);
        await Handovers.NotifyAsync(c, staff ? "HandoverCompleted" : dispute ? "HandoverDisputed" : "HandoverTenantConfirmed", Actor, h.Version, t);
        Remember(key, operation, new { id, x }, id); return HandoverView(h);
    }, t);
    public async Task<ContractId> UploadHandoverEvidenceAsync(Guid id, Stream input, CancellationToken t)
    {
        Role(Roles.Staff); await Load(id, [Roles.Staff], t);
        using var buffer = new MemoryStream(); var block = new byte[81920];
        while (true) { var n = await input.ReadAsync(block, t); if (n == 0) break; if (buffer.Length + n > 5 * 1024 * 1024) throw new ContractException(413, "inspection_image_too_large"); await buffer.WriteAsync(block.AsMemory(0, n), t); }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async c =>
        {
            HandoverActive(c);
            await RequireLegacyHandoverCompatibility(c, t);
            if ((await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, t)).Count >= 200) throw ContractException.Conflict("handover_evidence_limit");
            var f = new ContractDocumentFile { ContractId = id, Kind = ContractFileKind.HandoverEvidence, SnapshotHash = c.SnapshotHash, DevelopmentOnly = c.IsDevelopmentDemo, ContentType = type, Length = bytes.Length, FileHash = FileHash(bytes), RecordedByUserId = Actor, RecordedAt = clock.GetUtcNow() };
            f.ObjectKey = $"contracts/{id:N}/handover/{f.Id:N}"; await files.PutAsync(c.RoomId, f.ObjectKey, bytes, type, t); repository.Add(f); Audit("ContractHandoverEvidenceAdded", id); return new ContractId(f.Id);
        }, t);
    }
    public async Task CopyHandoverEvidenceAsync(Guid id, Guid fileId, Stream output, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var h = await Handovers.GetAsync(id, t); var f = await Workflow.FileAsync(id, fileId, t) ?? throw ContractException.Missing();
        var recorded = h is not null && Snapshot(h).EvidenceIds.Contains(fileId) || await Handovers.HistoryContainsEvidenceAsync(id, fileId, t);
        if (f.Kind != ContractFileKind.HandoverEvidence || !recorded && f.RecordedByUserId != Actor) throw ContractException.Missing();
        await CopyVerifiedFile(f, output, t);
    }
    public async Task CopyHandoverMeterEvidenceAsync(Guid id, Guid readingId, Stream output, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var handover = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        var snapshot = Snapshot(handover);
        var recorded = new[] { snapshot.Electricity, snapshot.Water }.SingleOrDefault(r => r.Id == readingId);
        if (recorded is null)
        {
            var history = await Handovers.HistoryForReadingAsync(id, readingId, t) ?? throw ContractException.Missing();
            var previous = JsonSerializer.Deserialize<HandoverSnapshot>(history) ?? throw ContractException.Conflict("handover_integrity_failed");
            recorded = new[] { previous.Electricity, previous.Water }.SingleOrDefault(r => r.Id == readingId) ?? throw ContractException.Missing();
        }
        var current = await Handovers.ReadingAsync(contract.RoomId, readingId, t) ?? throw ContractException.Missing();
        using var buffer = new MemoryStream(); await storage.CopyToAsync(current.EvidenceObjectKey, buffer, t);
        if (FileHash(buffer.ToArray()) != recorded.EvidenceHash) throw ContractException.Conflict("handover_evidence_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t);
    }
}
