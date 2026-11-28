using BHome.Domain.IdentityAccess;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IHoldingSettingsData HoldingSettingsData => holdingSettings ?? throw new ContractException(503, "holding_settings_unavailable");

    public Task<HoldingSettings?> GlobalHoldingSettingsAsync(CancellationToken t)
    {
        Role(Roles.Owner);
        return HoldingSettingsData.GetForOwnerAsync(Actor, t);
    }

    public Task<IReadOnlyList<HoldingSettings>> GlobalHoldingSettingsHistoryAsync(CancellationToken t)
    {
        Role(Roles.Owner);
        return HoldingSettingsData.HistoryForOwnerAsync(Actor, t);
    }

    public async Task SetGlobalHoldingSettingsAsync(HoldingSettingsInput input, CancellationToken t)
    {
        Role(Roles.Owner);
        Validate(input);
        if (string.IsNullOrWhiteSpace(input.Terms)) throw ContractException.Invalid("invalid_holding_configuration");
        await HoldingSettingsData.SetForOwnerAsync(Actor, input with { Terms = input.Terms.Trim() }, Actor, clock.GetUtcNow(), t);
    }

    // Location routes remain for older clients, but now read/write the same Owner-wide policy.
    public async Task<HoldingSettings?> HoldingSettingsAsync(Guid locationId, CancellationToken t)
    {
        Role(Roles.Owner);
        if (!await access.CanAccessAsync(new(locationId, null), [Roles.Owner], t)) throw ContractException.Missing();
        return await HoldingSettingsData.GetForLocationAsync(locationId, t);
    }

    public async Task<IReadOnlyList<HoldingSettings>> HoldingSettingsHistoryAsync(Guid locationId, CancellationToken t)
    {
        Role(Roles.Owner);
        if (!await access.CanAccessAsync(new(locationId, null), [Roles.Owner], t)) throw ContractException.Missing();
        return await GlobalHoldingSettingsHistoryAsync(t);
    }

    public async Task SetHoldingSettingsAsync(Guid locationId, HoldingSettingsInput input, CancellationToken t)
    {
        Role(Roles.Owner);
        if (!await access.CanAccessAsync(new(locationId, null), [Roles.Owner], t)) throw ContractException.Missing();
        await SetGlobalHoldingSettingsAsync(input, t);
    }

    public async Task<HoldingPreparation> HoldingPreparationAsync(Guid roomId, CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff);
        await ScopeRoom(roomId, t);
        var room = (await repository.RoomAsync(roomId, t))!;
        var settings = await HoldingSettingsData.GetForLocationAsync(room.LocationId, t)
            ?? throw ContractException.Conflict("holding_settings_required");
        var prices = await repository.ResolvePricesAsync(roomId, Today, t);
        var rent = prices.Charges.SingleOrDefault(p => p.ChargeCode == "RENT")?.Rate
            ?? throw ContractException.Conflict("rent_policy_required");
        Money(decimal.Truncate(rent), false);
        var end = Today.AddMonths(1);
        var expiry = new DateTimeOffset(end.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var monthlyRent = decimal.Truncate(rent);
        return new(roomId, room.LocationId, room.RoomNumber, settings.Version, 1, Today, end, expiry,
            monthlyRent, monthlyRent, settings.Terms);
    }
}
