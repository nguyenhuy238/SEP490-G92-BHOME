using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
namespace BHome.Application.Contracts;
public sealed partial class ContractService
{
    private async Task<(Contract Contract, ContractHandover? Handover)> Baseline(Contract c, CancellationToken t)
    {
        var seen = new HashSet<Guid>();
        while (seen.Add(c.Id))
        {
            var handover = await Handovers.GetAsync(c.Id, t);
            if (handover?.Status == ContractHandoverStatus.Confirmed) return (c, handover);
            if (c.PreviousContractId is not { } previous) return (c, null);
            c = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        }
        throw ContractException.Conflict("contract_version_integrity_failed");
    }
    public async Task<InspectionPreparation> InspectionPreparationAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff], t); var (root, h) = await Baseline(c, t);
        return new(h is null ? null : HandoverView(h), h is null ? null : root.Id, await repository.FinalReadingsAsync(id, c.RoomId, Today, t), await repository.HasOtherActiveContractsAsync(c.RoomId, id, t));
    }
    private async Task RecordFinalInspection(Contract c, ContractMoveOut m, InspectionInput x, CancellationToken t)
    {
        // Legacy requests stay readable; only a complete baseline comparison can satisfy the production ledger.
        var (root, h) = await Baseline(c, t);
        if (h is null) { m.PendingReason = "confirmed_handover_baseline_required"; return; }
        if (x.Assets is null || x.RoomCondition is null || x.KeysAndAccess is null) throw ContractException.Invalid("inspection_checklist_required");
        var baseline = Snapshot(h);
        if (x.Assets.Length != baseline.Assets.Length || x.Assets.Select(a => a.Id).Distinct().Count() != x.Assets.Length || baseline.Assets.Any(a => !x.Assets.Any(i => i.Id == a.Id))) throw ContractException.Invalid("inspection_asset_snapshot_mismatch");
        var readings = await repository.FinalReadingsAsync(c.Id, c.RoomId, Today, t);
        var electricity = readings.Single(r => r.Id == x.ElectricityReadingId); var water = readings.Single(r => r.Id == x.WaterReadingId);
        foreach (var r in new[] { electricity, water }) { using var bytes = new MemoryStream(); await storage.CopyToAsync(r.EvidenceObjectKey, bytes, t); if (FileHash(bytes.ToArray()) != r.EvidenceHash) throw ContractException.Conflict("inspection_evidence_integrity_failed"); }
        var observed = new HandoverSnapshot(Today, c.Room.RoomNumber, HandoverText(x.RoomCondition, 2000), HandoverText(x.KeysAndAccess, 2000), x.Notes.Trim(),
            baseline.Assets.Select(a => new HandoverAsset(a.Id, a.Name, a.ObservedCondition, HandoverText(x.Assets.Single(i => i.Id == a.Id).Condition, 1000))).ToArray(), electricity, water, x.EvidenceIds);
        repository.Add(new ContractFinalInspection
        {
            ContractId = c.Id,
            Version = (await repository.FinalInspectionsAsync(c.Id, t)).Select(i => i.Version).DefaultIfEmpty(0).Max() + 1,
            BaselineContractId = root.Id,
            BaselineVersion = h.Version,
            BaselineSnapshot = h.Snapshot,
            ObservedSnapshot = JsonSerializer.Serialize(observed),
            StaffId = Actor,
            InspectedAt = clock.GetUtcNow()
        });
    }
    public async Task<IReadOnlyList<FinalInspectionView>> FinalInspectionsAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        return (await repository.FinalInspectionsAsync(id, t)).Select(i => new FinalInspectionView(i.Id, i.Version, i.BaselineContractId, i.BaselineVersion,
            JsonSerializer.Deserialize<HandoverSnapshot>(i.BaselineSnapshot)!, JsonSerializer.Deserialize<HandoverSnapshot>(i.ObservedSnapshot)!, i.StaffId, i.InspectedAt, i.OwnerDecision, i.OwnerReason, i.ReviewedAt)).ToArray();
    }
    public Task<MoveOutView> ReviewInspectionAsync(Guid id, InspectionReviewInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-review", new { id, x }, t) is not null) return View(m);
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault() ?? throw ContractException.Conflict("confirmed_handover_baseline_required");
        if (inspection.Version != x.Version || inspection.OwnerDecision != null || m.Status != MoveOutStatus.Inspected) throw ContractException.Conflict("inspection_changed_or_reviewed");
        inspection.OwnerReason = HandoverText(x.Reason, 2000); inspection.OwnerDecision = x.Confirmed ? "Confirmed" : "Reinspection"; inspection.OwnerId = Actor; inspection.ReviewedAt = clock.GetUtcNow();
        inspection.NoAdditionalCharges = x.Confirmed && x.NoAdditionalCharges;
        if (!x.Confirmed) m.Status = MoveOutStatus.Approved;
        m.Version++; MoveOutEvent(m, x.Confirmed ? "InspectionConfirmed" : "ReinspectionRequired"); Audit("ContractInspectionReviewed", id); Remember(key, "inspection-review", new { id, x }, m.Id); return View(m);
    }, t);
}
