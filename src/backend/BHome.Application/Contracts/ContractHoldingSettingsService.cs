using BHome.Domain.IdentityAccess;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IHoldingSettingsData HoldingSettingsData => holdingSettings ?? throw new ContractException(503, "holding_settings_unavailable");
    public async Task<HoldingSettings?> HoldingSettingsAsync(Guid locationId, CancellationToken t)
    {
        Role(Roles.Owner);
        if (!await access.CanAccessAsync(new(locationId, null), [Roles.Owner], t)) throw ContractException.Missing();
        return await HoldingSettingsData.GetAsync(locationId, t);
    }
    public async Task SetHoldingSettingsAsync(Guid locationId, HoldingSettingsInput input, CancellationToken t)
    {
        Role(Roles.Owner); Validate(input);
        if (!await access.CanAccessAsync(new(locationId, null), [Roles.Owner], t)) throw ContractException.Missing();
        if (input.DepositRentMonths <= 0 || input.DepositRentMonths > 120 || decimal.Round(input.DepositRentMonths, 2) != input.DepositRentMonths || string.IsNullOrWhiteSpace(input.Terms))
            throw ContractException.Invalid("invalid_holding_configuration");
        await HoldingSettingsData.SetAsync(locationId, input with { Terms = input.Terms.Trim() }, Actor, clock.GetUtcNow(), t);
    }
    public async Task<HoldingPreparation> HoldingPreparationAsync(Guid roomId, CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff); await ScopeRoom(roomId, t);
        var room = (await repository.RoomAsync(roomId, t))!;
        var settings = await HoldingSettingsData.GetAsync(room.LocationId, t) ?? throw ContractException.Conflict("holding_settings_required");
        var prices = await repository.ResolvePricesAsync(roomId, Today, t);
        var rent = prices.Charges.SingleOrDefault(p => p.ChargeCode == "RENT")?.Rate ?? throw ContractException.Conflict("rent_policy_required");
        Money(decimal.Truncate(rent), false);
        var end = Today.AddMonths(settings.HoldingMonths);
        var expiry = new DateTimeOffset(end.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var deposit = decimal.Truncate(rent * settings.DepositRentMonths); Money(deposit, false);
        return new(roomId, room.LocationId, room.RoomNumber, settings.Version, settings.HoldingMonths,
            Today, end, expiry, decimal.Truncate(rent), deposit, settings.Terms);
    }
}
