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
}
