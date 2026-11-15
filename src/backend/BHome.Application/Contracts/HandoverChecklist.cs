namespace BHome.Application.Contracts;

public static class HandoverChecklist
{
    public static HandoverAsset[] Inspect(HandoverAsset[] source, HandoverAssetInput[] input, bool quantitiesRequired)
    {
        if (input is null || input.Length > 200 || input.Any(i => i is null) ||
            input.Select(i => i.Id).Distinct().Count() != input.Length || input.Length != source.Length ||
            source.Any(s => !input.Any(i => i.Id == s.Id)))
            throw ContractException.Invalid("handover_asset_inventory_changed");
        return source.Select(s =>
        {
            var i = input.Single(i => i.Id == s.Id);
            if (string.IsNullOrWhiteSpace(i.Condition) || i.Condition.Length > 1000 || i.Notes?.Length > 2000 ||
                i.EvidenceIds is { } ids && (ids.Length > 5 || ids.Contains(Guid.Empty) || ids.Distinct().Count() != ids.Length))
                throw ContractException.Invalid("invalid_handover_input");
            var values = new[] { i.ObservedQuantity, i.HandedOverQuantity, i.GoodQuantity, i.WornQuantity, i.DamagedQuantity, i.MissingQuantity };
            var hasQuantities = values.Any(v => v is not null);
            if ((quantitiesRequired || hasQuantities) && (values.Any(v => v is null or < 0 or > 10000) ||
                i.GoodQuantity + i.WornQuantity + i.DamagedQuantity != i.ObservedQuantity || i.HandedOverQuantity > i.ObservedQuantity ||
                i.MissingQuantity != Math.Max(0, (s.ConfiguredQuantity ?? s.HandedOverQuantity ?? s.PhysicalAssets?.Sum(p => p.Quantity) ?? 0) - i.ObservedQuantity!.Value)))
                throw ContractException.Invalid("invalid_handover_quantities");
            if (hasQuantities && i.HandedOverQuantity < i.ObservedQuantity && string.IsNullOrWhiteSpace(i.Notes))
                throw ContractException.Invalid("withheld_asset_reason_required");
            var observed = s with
            {
                ObservedCondition = i.Condition.Trim(), ObservedQuantity = i.ObservedQuantity, HandedOverQuantity = i.HandedOverQuantity,
                GoodQuantity = i.GoodQuantity, WornQuantity = i.WornQuantity, DamagedQuantity = i.DamagedQuantity,
                MissingQuantity = i.MissingQuantity, Checked = i.Checked, Notes = i.Notes?.Trim(), EvidenceIds = i.EvidenceIds ?? [],
                PhysicalObservations = i.PhysicalObservations
            };
            if (Problem(observed) && observed.EvidenceIds.Length == 0) throw ContractException.Invalid("asset_group_evidence_required");
            if (i.PhysicalObservations is { } physical)
            {
                var expected = s.PhysicalAssets ?? [];
                if (physical.Length != expected.Length || physical.Any(p => p is null || p.Quantity is < 0 or > 10000 ||
                    string.IsNullOrWhiteSpace(p.Condition) || p.Condition.Length > 1000 || !expected.Any(e => e.Id == p.Id)) ||
                    physical.Select(p => p.Id).Distinct().Count() != physical.Length || physical.Sum(p => p.Quantity) != i.ObservedQuantity)
                    throw ContractException.Invalid("invalid_physical_asset_quantities");
            }
            return observed;
        }).ToArray();
    }

    public static bool Problem(HandoverAsset a) => a.MissingQuantity > 0 || a.DamagedQuantity > 0 ||
        a.ObservedQuantity != null && (a.ObservedQuantity != (a.PhysicalAssets?.Sum(p => p.Quantity) ?? 0) || a.HandedOverQuantity < a.ObservedQuantity);
    public static bool RequiresOwner(HandoverSnapshot s) => !s.NoAssetsConfirmed && (s.Assets.Length == 0 ||
        s.Assets.Any(a => a.ConfigurationItemId is not null && !a.OwnerChecked || Problem(a)));
}
