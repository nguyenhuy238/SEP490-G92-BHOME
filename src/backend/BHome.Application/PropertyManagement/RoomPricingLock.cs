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

    // Only scheduling a successor for a service fee may bypass the room lock.
    // Billing must already be able to read every binding contract from its sealed snapshot.
    internal static async Task EnsureServiceFeeSuccessorAsync(IPropertyRepository repository, Guid locationId, Guid? roomId, CancellationToken t)
    {
        if (roomId is not { } room || !await repository.HasBindingPriceContractAsync(room, t)) return;
        var contracts = await repository.BindingPriceContractsAsync(room, t);
        if (contracts.Count == 0) throw new PropertyException(409, "room_pricing_locked_by_contract");
        foreach (var contract in contracts)
        {
            var missing = new List<string>();
            _ = BHome.Application.Billing.ContractBillingPrices.Read(contract, locationId, missing);
            if (missing.Count != 0) throw new PropertyException(409, "contract_price_snapshot_required_for_successor");
        }
    }
}
