using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

internal static class RoomPricingLock
{
    // Caller holds the Location advisory lock, shared with contract transitions.
    internal static async Task EnsureUnlockedAsync(IPropertyRepository repository, Guid? roomId, CancellationToken t)
    {
        if (roomId is not { } room) return;
        if (await repository.HasBindingPriceContractAsync(room, t))
            throw new PropertyException(409, "room_pricing_locked_by_contract");
    }

    private static async Task<IReadOnlyList<ScopedPriceContract>> ScopeContractsAsync(IPropertyRepository repository,
        BillingPolicy policy, string errorCode, CancellationToken t)
    {
        if (policy.RoomId is { } room)
        {
            var contracts = await repository.BindingPriceContractsAsync(room, t);
            if (contracts.Count == 0 && await repository.HasBindingPriceContractAsync(room, t))
                throw new PropertyException(409, errorCode);
            return contracts.Select(c => new ScopedPriceContract(policy.LocationId, null, c)).ToArray();
        }
        var contractsAtLocation = await repository.BindingPriceContractsForLocationsAsync([policy.LocationId], t);
        return contractsAtLocation.Where(c => Applies(policy.LocationId, policy.RoomId, policy.RoomTypeId, c)).ToArray();
    }

    internal static bool Applies(Guid locationId, Guid? roomId, Guid? roomTypeId, ScopedPriceContract binding) =>
        binding.LocationId == locationId && (!roomId.HasValue || binding.Contract.RoomId == roomId) &&
        (!roomTypeId.HasValue || binding.RoomTypeId == roomTypeId);

    internal static HoldingPriceSnapshot? ValidSnapshot(ScopedPriceContract binding)
    {
        var missing = new List<string>();
        _ = ContractBillingPrices.Read(binding.Contract, binding.LocationId, missing);
        return missing.Count == 0 ? ContractChargeSnapshot.Read(binding.Contract) : null;
    }

    internal static bool References(PolicyDto policy, HoldingPriceSnapshot snapshot) =>
        snapshot.Charges.Any(c => c.PolicyId == policy.Id &&
            c.ChargeCode == policy.ChargeCode && c.Category == (int)policy.Category &&
            (c.PolicyLocationId is null || c.PolicyLocationId == policy.LocationId &&
                c.PolicyRoomId == policy.RoomId && c.PolicyRoomTypeId == policy.RoomTypeId));

    internal static async Task EnsureSuccessorAsync(IPropertyRepository repository, BillingPolicy policy, CancellationToken t)
    {
        foreach (var binding in await ScopeContractsAsync(repository, policy, "contract_price_snapshot_required_for_successor", t))
        {
            var snapshot = ValidSnapshot(binding);
            if (snapshot is null || snapshot.Charges.Any(c => c.PolicyId == policy.Id) &&
                !References(PropertyService.Map(policy), snapshot))
                throw new PropertyException(409, "contract_price_snapshot_required_for_successor");
        }
    }

    internal static async Task EnsurePolicyNotBoundAsync(IPropertyRepository repository, BillingPolicy policy, CancellationToken t)
    {
        foreach (var binding in await ScopeContractsAsync(repository, policy, "room_pricing_locked_by_contract", t))
        {
            var snapshot = ValidSnapshot(binding);
            if (snapshot is null || snapshot.Charges.Any(c => c.PolicyId == policy.Id))
                throw new PropertyException(409, "room_pricing_locked_by_contract");
        }
    }

    internal static IReadOnlyList<PolicyDto> Describe(IReadOnlyList<PolicyDto> policies,
        IReadOnlyList<ScopedPriceContract> bindings, IReadOnlyDictionary<Guid, PolicyLineage> lineages, DateOnly today)
    {
        var byId = policies.ToDictionary(p => p.Id);
        var endDates = new Dictionary<Guid, DateOnly>();
        var counts = new Dictionary<Guid, int>();
        var uncertain = new HashSet<Guid>();
        foreach (var binding in bindings)
        {
            if (ValidSnapshot(binding) is not { } snapshot)
            {
                foreach (var policy in policies.Where(p => Applies(p.LocationId, p.RoomId, p.RoomTypeId, binding)))
                    uncertain.Add(policy.Id);
                continue;
            }
            foreach (var charge in snapshot.Charges)
            {
                if (!byId.TryGetValue(charge.PolicyId, out var policy) ||
                    !Applies(policy.LocationId, policy.RoomId, policy.RoomTypeId, binding)) continue;
                if (!References(policy, snapshot)) { uncertain.Add(policy.Id); continue; }
                if (!endDates.TryGetValue(policy.Id, out var previous) || binding.Contract.EndDate > previous)
                    endDates[policy.Id] = binding.Contract.EndDate;
                counts[policy.Id] = counts.GetValueOrDefault(policy.Id) + 1;
            }
        }
        return policies.Select(p =>
        {
            var lineage = lineages.TryGetValue(p.Id, out var known) ? known : new PolicyLineage(p.Id, 1);
            return p with
            {
                LastContractEndDate = endDates.TryGetValue(p.Id, out var end) ? end : null,
                BindingContractCount = counts.GetValueOrDefault(p.Id),
                CanEditInPlace = p.EffectiveFrom > today && !p.FirstUsedAt.HasValue &&
                    !counts.ContainsKey(p.Id) && !uncertain.Contains(p.Id),
                FamilyId = lineage.FamilyId,
                Edition = lineage.Edition,
                PreviousPolicyId = lineage.PreviousPolicyId
            };
        }).ToArray();
    }
}
