namespace BHome.Application.Contracts;

public static class HandoverChecklist
{
    public static HandoverAsset[] Inspect(HandoverAsset[] source, HandoverAssetInput[] input, bool quantitiesRequired, bool baselineKnown = true)
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
                i.MissingQuantity != (baselineKnown ? Math.Max(0, (s.ConfiguredQuantity ?? s.HandedOverQuantity ?? s.PhysicalAssets?.Sum(p => p.Quantity) ?? 0) - i.ObservedQuantity!.Value) : 0)))
                throw ContractException.Invalid("invalid_handover_quantities");
            var observed = s with
            {
                ObservedCondition = i.Condition.Trim(),
                ObservedQuantity = i.ObservedQuantity,
                HandedOverQuantity = i.HandedOverQuantity,
                GoodQuantity = i.GoodQuantity,
                WornQuantity = i.WornQuantity,
                DamagedQuantity = i.DamagedQuantity,
                MissingQuantity = i.MissingQuantity,
                Checked = i.Checked,
                Notes = i.Notes?.Trim(),
                EvidenceIds = i.EvidenceIds ?? [],
                PhysicalObservations = i.PhysicalObservations
            };
            // Evidence and observations are optional even for a recorded
            // defect. An absent photo is never treated as proof of Tenant damage.
            if (i.PhysicalObservations is { } physical)
            {
                var expected = s.PhysicalAssets ?? [];
                if (physical.Length != expected.Length || physical.Any(p => p is null || p.Quantity is < 0 or > 10000 ||
                    p.HandedOverQuantity is < 0 || p.HandedOverQuantity > p.Quantity ||
                    string.IsNullOrWhiteSpace(p.Condition) || p.Condition.Length > 1000 || !expected.Any(e => e.Id == p.Id)) ||
                    physical.Select(p => p.Id).Distinct().Count() != physical.Length || physical.Sum(p => p.Quantity) != i.ObservedQuantity)
                    throw ContractException.Invalid("invalid_physical_asset_quantities");
                if (i.HandedOverQuantity != i.ObservedQuantity && (physical.Any(p => p.HandedOverQuantity is null) || physical.Sum(p => p.HandedOverQuantity) != i.HandedOverQuantity))
                    throw ContractException.Invalid("physical_asset_handover_quantities_required");
            }
            return observed;
        }).ToArray();
    }

    public static bool Problem(HandoverAsset a) => a.MissingQuantity > 0 || a.DamagedQuantity > 0 ||
        a.ObservedQuantity != null && (a.ObservedQuantity != (a.PhysicalAssets?.Sum(p => p.Quantity) ?? 0) || a.HandedOverQuantity < a.ObservedQuantity);
    // Financial liability must be demonstrably new relative to the signed
    // move-in baseline. A pre-existing damaged or missing unit is not a new
    // tenant charge, and missing baselines cannot be silently inferred.
    private static bool VerifiedGoodCondition(string? value) =>
        value?.Trim() is "Tốt" or "Good" or "Passed";

    private static bool NewPhysicalIssueAgainstBaseline(HandoverAsset observed, HandoverAsset baseline) =>
        (observed.PhysicalObservations ?? []).Any(item =>
        {
            var opening = baseline.PhysicalObservations?.FirstOrDefault(p => p.Id == item.Id)?.Condition
                ?? baseline.PhysicalAssets?.FirstOrDefault(p => p.Id == item.Id)?.Condition;
            return VerifiedGoodCondition(opening) &&
                !string.IsNullOrWhiteSpace(item.Condition) && !VerifiedGoodCondition(item.Condition);
        });

    public static bool NewDamageAgainstBaseline(HandoverAsset observed, HandoverAsset? baseline) =>
        // Inspection without a confirmed opening quantity is still valid, but
        // it cannot be proof of NEW tenant-caused loss/damage for settlement.
        observed.Checked && baseline is { HandedOverQuantity: not null } &&
        (observed.MissingQuantity is { } missing && missing > baseline.MissingQuantity.GetValueOrDefault() ||
         observed.DamagedQuantity is { } damaged && baseline.DamagedQuantity is { } initiallyDamaged && damaged > initiallyDamaged ||
         observed.HandedOverQuantity is { } returned &&
         baseline.HandedOverQuantity is { } given && returned < given ||
         // Move-Out now records the observed condition without fabricating a
         // good/worn/damaged quantity split. A change from verified "Good" to
         // "Issue" must remain reviewable, including per-physical-item changes.
         VerifiedGoodCondition(baseline.ObservedCondition) &&
         !string.IsNullOrWhiteSpace(observed.ObservedCondition) &&
         !VerifiedGoodCondition(observed.ObservedCondition) ||
         NewPhysicalIssueAgainstBaseline(observed, baseline));
    public static bool RequiresOwner(HandoverSnapshot s) => !s.NoAssetsConfirmed && (s.Assets.Length == 0 ||
        s.Assets.Any(a => !a.OwnerChecked || Problem(a)));

    public static void RequireSeparateEvidence(Guid[] overall, HandoverAsset[] assets)
    {
        if (assets.Where(Problem).Any(a => (a.EvidenceIds ?? []).Intersect(overall).Any()))
            throw ContractException.Invalid("asset_group_evidence_must_be_separate");
    }
}
