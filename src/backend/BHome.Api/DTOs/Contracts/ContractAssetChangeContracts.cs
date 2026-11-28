namespace BHome.Application.Contracts;

public sealed record AssetChangeParty(Guid ContractId, Guid? TenantId);
public sealed record AssetChangeSource(Guid Id, Guid AssetId, string Label, Guid? WorkOrderId = null);
public sealed record AssetChangeLine(Guid GroupId, Guid? RemovedAssetId, Guid? AddedAssetId, int AddedQuantity,
    int WithdrawnQuantity, string Condition, Guid[] EvidenceIds);
public sealed record AssetChangeInput(Guid SourceId, string Kind, DateOnly Date, string Reason,
    string InventoryToken, AssetChangeLine[] Lines);
public sealed record AssetChangeAcknowledgement(Guid ContractId, Guid TenantId, DateTimeOffset At, bool Accepted, string Reason, Guid? ActingContractId = null);
public sealed record AssetChangeData(Guid RoomId, Guid SourceId, string Kind, DateOnly Date, string Reason, Guid StaffId,
    AssetChangeLine[] Lines, HandoverAsset[] Assets, AssetChangeParty[] Parties, AssetChangeAcknowledgement[] Acknowledgements,
    Guid EvidenceContractId, DateTimeOffset RecordedAt);
public sealed record AssetChangeView(Guid Id, int Version, string Status, AssetChangeData Data, Guid? AcknowledgementContractId = null);
public sealed record AssetChangePreparation(HandoverInventory Inventory, IReadOnlyList<AssetChangeSource> Sources, HandoverSnapshot? Baseline);

public static class HandoverBaseline
{
    // Each room event is applied once; callers select only this tenancy's explicit acknowledgements.
    public static HandoverSnapshot Apply(HandoverSnapshot original, IEnumerable<AssetChangeView> events)
    {
        var groups = original.Assets.Select(a => a with
        {
            PhysicalAssets = a.HandedOverQuantity is null ? a.PhysicalAssets :
            (a.PhysicalAssets ?? []).Select(p => p with
            {
                Quantity = a.PhysicalAssets!.Length == 1 ? a.HandedOverQuantity.Value :
                a.PhysicalObservations?.SingleOrDefault(o => o.Id == p.Id)?.HandedOverQuantity ??
                a.PhysicalObservations?.SingleOrDefault(o => o.Id == p.Id)?.Quantity ?? p.Quantity
            }).ToArray()
        }).ToDictionary(a => a.Id);
        foreach (var change in events.DistinctBy(e => e.Id).OrderBy(e => e.Data.RecordedAt).ThenBy(e => e.Id))
            foreach (var line in change.Data.Lines)
            {
                groups.TryGetValue(line.GroupId, out var previous);
                previous ??= groups.Values.SingleOrDefault(a => (a.PhysicalAssets ?? []).Any(p => p.Id == (line.RemovedAssetId ?? line.AddedAssetId)));
                var groupId = previous?.Id ?? line.GroupId;
                var recorded = change.Data.Assets.Single(a => a.Id == line.GroupId);
                int? quantity = (previous is null ? 0 : previous.HandedOverQuantity) + line.AddedQuantity - line.WithdrawnQuantity;
                if (quantity < 0) throw ContractException.Conflict("asset_change_baseline_invalid");
                var physical = (previous?.PhysicalAssets ?? []).ToList();
                if (line.RemovedAssetId is { } removed)
                {
                    var old = physical.SingleOrDefault(p => p.Id == removed);
                    if (old is null || old.Quantity < line.WithdrawnQuantity) throw ContractException.Conflict("asset_change_baseline_invalid");
                    physical.Remove(old);
                    if (old.Quantity > line.WithdrawnQuantity) physical.Add(old with { Quantity = old.Quantity - line.WithdrawnQuantity });
                }
                if (line.AddedAssetId is { } added)
                {
                    var value = recorded.PhysicalAssets?.SingleOrDefault(p => p.Id == added) ?? throw ContractException.Conflict("asset_change_baseline_invalid");
                    var old = physical.SingleOrDefault(p => p.Id == added); if (old is not null) physical.Remove(old);
                    physical.Add(value with { Quantity = (old?.Quantity ?? 0) + line.AddedQuantity });
                }
                if (quantity == 0) groups.Remove(groupId);
                else groups[groupId] = (previous ?? recorded) with
                {
                    HandedOverQuantity = quantity,
                    // The event has a confirmed total and a condition description, not a new
                    // count-by-condition inspection. Preserve history without inventing its split.
                    ObservedQuantity = null,
                    GoodQuantity = null,
                    WornQuantity = null,
                    DamagedQuantity = null,
                    MissingQuantity = null,
                    ObservedCondition = previous is null ? line.Condition : previous.ObservedCondition + "\n" +
                        $"{(change.Data.Kind == "Supplement" ? "Bổ sung" : change.Data.Kind == "Replacement" ? "Thay thế" : "Thu hồi")} ({change.Data.Date:dd/MM/yyyy}): {line.Condition}",
                    PhysicalAssets = physical.ToArray()
                };
            }
        return original with { Assets = groups.Values.ToArray(), NoAssetsConfirmed = groups.Count == 0 && original.NoAssetsConfirmed };
    }
}
