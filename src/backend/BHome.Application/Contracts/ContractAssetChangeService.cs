using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private ISetupWorkspaceStore HandoverSetup => contractSetup ?? throw new ContractException(503, "handover_inventory_unavailable");
    private static AssetChangeView ChangeView(SetupDocument doc) => new(doc.Id, doc.Version, doc.Status,
        doc.Data.Deserialize<AssetChangeData>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw ContractException.Conflict("asset_change_integrity_failed"));
    private async Task<AssetChangeView[]> RoomChanges(Contract c, CancellationToken t) =>
        (await HandoverSetup.ListAsync(c.Room.LocationId, "ContractAssetChange", t)).Select(ChangeView).Where(e => e.Data.RoomId == c.RoomId).ToArray();
    private async Task<HashSet<Guid>> HandoverLineage(Contract c, CancellationToken t)
    {
        var chain = new HashSet<Guid>(); var current = c;
        while (true)
        {
            if (!chain.Add(current.Id) || current.RoomId != c.RoomId || current.TenantUserId != c.TenantUserId)
                throw ContractException.Conflict("contract_version_integrity_failed");
            if (current.PreviousContractId is not { } previous) return chain;
            current = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        }
    }
    private AssetChangeView ScopedAssetChange(AssetChangeView change, HashSet<Guid> chain)
    {
        var view = change with { AcknowledgementContractId = change.Data.Parties.First(p => chain.Contains(p.ContractId)).ContractId };
        return user.IsInRole(Roles.Tenant) ? view with
        {
            Data = view.Data with
            {
                Parties = view.Data.Parties.Where(p => chain.Contains(p.ContractId)).ToArray(),
                Acknowledgements = view.Data.Acknowledgements.Where(a => chain.Contains(a.ContractId)).ToArray(),
                EvidenceContractId = Guid.Empty
            }
        } : view;
    }
    public async Task<IReadOnlyList<AssetChangeView>> AssetChangesAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var chain = await HandoverLineage(c, t);
        return (await RoomChanges(c, t)).Where(e => e.Data.Parties.Any(p => chain.Contains(p.ContractId)))
            .Select(e => ScopedAssetChange(e, chain)).ToArray();
    }
    public async Task<AssetChangePreparation> AssetChangePreparationAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff], t); HandoverActive(c);
        var (_, h) = await Baseline(c, t);
        return new(await (handoverInventory ?? throw new ContractException(503, "handover_inventory_unavailable")).PrepareAsync(c.RoomId, t),
            await Handovers.ChangeSourcesAsync(c.RoomId, t), h is null ? null : await EffectiveBaseline(c, Snapshot(h), t));
    }
    private async Task<HandoverSnapshot> EffectiveBaseline(Contract c, HandoverSnapshot original, CancellationToken t, bool includePending = false)
    {
        if (contractSetup is null) return original;
        var chain = await HandoverLineage(c, t);
        var events = (await RoomChanges(c, t)).Where(e => includePending ? e.Data.Parties.Any(p => chain.Contains(p.ContractId)) : e.Data.Acknowledgements.Any(a => chain.Contains(a.ContractId) && a.Accepted));
        return HandoverBaseline.Apply(original, events);
    }
    public Task<AssetChangeView> CreateAssetChangeAsync(Guid id, AssetChangeInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Staff], async c =>
    {
        HandoverActive(c);
        var eventId = HandoverKey($"asset-change:{c.RoomId:N}:{x.SourceId:N}");
        if (await Replay(key, "asset-change", new { id, x }, t) is not null)
            return ChangeView(await HandoverSetup.GetAsync(eventId, "ContractAssetChange", t) ?? throw ContractException.Missing());
        if (await HandoverSetup.GetAsync(eventId, "ContractAssetChange", t) is not null) throw ContractException.Conflict("asset_change_source_already_used");
        if (x.Kind is not ("Supplement" or "Replacement" or "Withdrawal") || x.Date < c.StartDate || x.Date > Today || x.Lines is null ||
            x.Lines.Length is < 1 or > 50 || x.Lines.Any(l => l is null) || x.Lines.Select(l => l.GroupId).Distinct().Count() != x.Lines.Length)
            throw ContractException.Invalid("invalid_asset_change");
        var inventory = await (handoverInventory ?? throw new ContractException(503, "handover_inventory_unavailable")).PrepareAsync(c.RoomId, t);
        if (inventory.StateToken != x.InventoryToken) throw ContractException.Conflict("handover_asset_inventory_changed");
        var source = (await Handovers.ChangeSourcesAsync(c.RoomId, t)).SingleOrDefault(s => s.Id == x.SourceId) ?? throw ContractException.Invalid("asset_change_source_required");
        if (x.Kind == "Replacement" && source.WorkOrderId is null) throw ContractException.Invalid("verified_replacement_work_order_required");
        var (_, h) = await Baseline(c, t);
        if (h is null) throw ContractException.Conflict("confirmed_handover_baseline_required");
        var baseline = await EffectiveBaseline(c, Snapshot(h), t);
        var reserved = await EffectiveBaseline(c, Snapshot(h), t, includePending: true);
        var recorded = new List<HandoverAsset>();
        foreach (var line in x.Lines)
        {
            if (line.AddedQuantity is < 0 or > 10000 || line.WithdrawnQuantity is < 0 or > 10000 ||
                line.AddedQuantity + line.WithdrawnQuantity == 0 || line.EvidenceIds is null || line.EvidenceIds.Length is < 1 or > 5 ||
                line.EvidenceIds.Distinct().Count() != line.EvidenceIds.Length || string.IsNullOrWhiteSpace(line.Condition) || line.Condition.Length > 1000 ||
                x.Kind == "Supplement" && (line.AddedQuantity == 0 || line.WithdrawnQuantity != 0) ||
                x.Kind == "Withdrawal" && (line.WithdrawnQuantity == 0 || line.AddedQuantity != 0) ||
                x.Kind == "Replacement" && (line.AddedQuantity == 0 || line.WithdrawnQuantity == 0)) throw ContractException.Invalid("invalid_asset_change");
            var before = baseline.Assets.SingleOrDefault(a => a.Id == line.GroupId);
            var added = inventory.Groups.SelectMany(a => a.PhysicalAssets ?? []).SingleOrDefault(a => a.Id == line.AddedAssetId);
            if (line.AddedQuantity > 0 && (added is null || added.Status != "Active" || added.Quantity < line.AddedQuantity)) throw ContractException.Invalid("asset_change_inventory_invalid");
            if (line.WithdrawnQuantity > 0 && (before?.HandedOverQuantity is null || before.HandedOverQuantity < line.WithdrawnQuantity ||
                !(before.PhysicalAssets ?? []).Any(p => p.Id == line.RemovedAssetId && p.Quantity >= line.WithdrawnQuantity))) throw ContractException.Invalid("asset_change_baseline_invalid");
            if (source.AssetId != line.AddedAssetId && source.AssetId != line.RemovedAssetId) throw ContractException.Invalid("asset_change_source_scope_invalid");
            if (line.WithdrawnQuantity > 0 && x.Kind == "Withdrawal")
            {
                var removed = await HandoverSetup.AssetAsync(line.RemovedAssetId!.Value, t);
                var remaining = inventory.Groups.SelectMany(g => g.PhysicalAssets ?? []).SingleOrDefault(p => p.Id == line.RemovedAssetId)?.Quantity ?? 0;
                var original = before!.PhysicalAssets!.Single(p => p.Id == line.RemovedAssetId).Quantity;
                if (removed?.RoomId != c.RoomId || remaining > original - line.WithdrawnQuantity) throw ContractException.Invalid("asset_withdrawal_operation_required");
            }
            if (x.Kind == "Replacement")
            {
                var replacement = await HandoverSetup.GetAsync(line.AddedAssetId!.Value, "AssetReplacement", t);
                if (replacement is null || replacement.Data.GetProperty("previousAssetId").GetGuid() != line.RemovedAssetId)
                    throw ContractException.Invalid("asset_replacement_relationship_required");
            }
            var group = before ?? inventory.Groups.SingleOrDefault(a => a.Id == line.GroupId) ?? throw ContractException.Invalid("asset_change_group_invalid");
            // An addition cannot acknowledge more physical quantity than actually exists.
            var already = reserved.Assets.SelectMany(a => a.PhysicalAssets ?? []).Where(p => p.Id == line.AddedAssetId).Sum(p => p.Quantity);
            if (added is not null && already + line.AddedQuantity > added.Quantity) throw ContractException.Invalid("asset_change_inventory_invalid");
            foreach (var evidenceId in line.EvidenceIds)
            {
                var file = await Workflow.FileAsync(id, evidenceId, t) ?? throw ContractException.Invalid("invalid_handover_evidence");
                if (file.Kind != ContractFileKind.HandoverEvidence) throw ContractException.Invalid("invalid_handover_evidence");
                await CopyVerifiedFile(file, Stream.Null, t);
            }
            recorded.Add(group with
            {
                ObservedCondition = line.Condition,
                EvidenceIds = line.EvidenceIds,
                PhysicalAssets = added is null ? group.PhysicalAssets : [added],
                HandedOverQuantity = line.AddedQuantity,
                ObservedQuantity = line.AddedQuantity,
                GoodQuantity = null,
                WornQuantity = null,
                DamagedQuantity = null,
                MissingQuantity = null,
                Notes = x.Reason
            });
        }
        var parties = (await Handovers.ActivePartiesAsync(c.RoomId, t)).ToArray();
        if (parties.Any(p => p.TenantId is null)) throw ContractException.Conflict("tenant_account_required_for_lifecycle");
        var data = new AssetChangeData(c.RoomId, x.SourceId, x.Kind, x.Date, HandoverText(x.Reason, 2000), Actor, x.Lines, recorded.ToArray(), parties, [], id, clock.GetUtcNow());
        var doc = await HandoverSetup.SaveAsync(eventId, c.Room.LocationId, "ContractAssetChange", "AwaitingTenant", data, 0, Actor, t);
        foreach (var party in parties)
        {
            var affected = party.ContractId == c.Id ? c : await repository.FindAsync(party.ContractId, t) ?? throw ContractException.Missing();
            await Handovers.NotifyAsync(affected, $"AssetChangeAwaitingTenant:{eventId:N}", Actor, doc.Version, t);
        }
        Audit("ContractAssetChangeRecorded", id); Remember(key, "asset-change", new { id, x }, eventId); return ChangeView(doc);
    }, t);
    public Task<AssetChangeView> ConfirmAssetChangeAsync(Guid id, Guid eventId, InspectionTenantFeedback x, Guid key, CancellationToken t) => Mutate(id, [Roles.Tenant], async c =>
    {
        HandoverActive(c);
        var doc = await HandoverSetup.GetAsync(eventId, "ContractAssetChange", t) ?? throw ContractException.Missing();
        var change = ChangeView(doc); var data = change.Data;
        var chain = await HandoverLineage(c, t);
        var party = data.Parties.SingleOrDefault(p => chain.Contains(p.ContractId) && p.TenantId == Actor);
        if (data.RoomId != c.RoomId || party is null) throw ContractException.Missing();
        if (await Replay(key, "asset-change-confirm", new { id, eventId, x }, t) is not null) return ScopedAssetChange(change, chain);
        // Acknowledgements are per contract. Another Tenant's response must not invalidate the physical event version.
        if (x.Version != 1 || data.Acknowledgements.Any(a => a.ContractId == party.ContractId && a.Accepted)) throw ContractException.Conflict("asset_change_already_answered");
        var acknowledgement = new AssetChangeAcknowledgement(party.ContractId, Actor, clock.GetUtcNow(), x.Confirmed, HandoverText(x.Reason, 2000, !x.Confirmed), id);
        data = data with { Acknowledgements = [.. data.Acknowledgements.Where(a => a.ContractId != party.ContractId), acknowledgement] };
        if (x.Confirmed)
        {
            var (_, baseline) = await Baseline(c, t);
            var snapshot = Snapshot(baseline ?? throw ContractException.Conflict("confirmed_handover_baseline_required")) with
            {
                Date = data.Date,
                Assets = data.Assets,
                Notes = data.Reason,
                EvidenceIds = data.Lines.SelectMany(l => l.EvidenceIds).Distinct().ToArray(),
                RoomCondition = "",
                KeysAndAccess = "",
                OwnerAcceptance = null,
                TenantFeedback = null,
                MissingBaselineReason = null,
                ProposedCompensation = null
            };
            await PersistReport(c, "AssetChange", 1, snapshot, null, data.StaffId, acknowledgement.At, acknowledgement.At,
                [$"{data.Kind}: {eventId}; source {data.SourceId}"], data.Lines.Select(l => $"Nhóm {l.GroupId}: thêm {l.AddedQuantity}, thu hồi {l.WithdrawnQuantity}; cũ {l.RemovedAssetId}, mới {l.AddedAssetId}").ToArray(), t, eventId, data.EvidenceContractId);
        }
        var saved = await HandoverSetup.SaveAsync(eventId, c.Room.LocationId, "ContractAssetChange",
            data.Acknowledgements.Count(a => a.Accepted) == data.Parties.Length ? "Confirmed" : data.Acknowledgements.Any(a => !a.Accepted) ? "Disputed" : "AwaitingTenant",
            data, doc.Version, Actor, t);
        await Handovers.NotifyAsync(c, $"AssetChangeTenantResponded:{eventId:N}", Actor, saved.Version, t);
        Audit("ContractAssetChangeTenantResponded", id); Remember(key, "asset-change-confirm", new { id, eventId, x }, eventId); return ScopedAssetChange(ChangeView(saved), chain);
    }, t);
    public async Task CopyAssetChangeEvidenceAsync(Guid id, Guid eventId, Guid evidenceId, Stream output, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var change = ChangeView(await HandoverSetup.GetAsync(eventId, "ContractAssetChange", t) ?? throw ContractException.Missing());
        var chain = await HandoverLineage(c, t);
        if (change.Data.RoomId != c.RoomId || !change.Data.Parties.Any(p => chain.Contains(p.ContractId)) || !change.Data.Lines.Any(l => l.EvidenceIds.Contains(evidenceId))) throw ContractException.Missing();
        var file = await Workflow.FileAsync(change.Data.EvidenceContractId, evidenceId, t) ?? throw ContractException.Missing();
        if (file.Kind != ContractFileKind.HandoverEvidence) throw ContractException.Missing();
        await CopyVerifiedFile(file, output, t);
    }
}
