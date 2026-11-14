using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Billing;

// Billing may run long after the room has been released and its prices changed.
// Only immutable contract terms are a valid source of charges.
public static class ContractBillingPrices
{
    public static IReadOnlyList<PolicyDto> Read(Contract contract, Guid locationId, List<string> missing)
    {
        HoldingPriceSnapshot? snapshot;
        try { snapshot = ContractChargeSnapshot.Read(contract); }
        catch (ContractException e) { missing.Add(e.Code); return []; }
        catch (JsonException) { missing.Add("contract_price_snapshot_invalid"); return []; }
        if (snapshot is null || snapshot.SnapshotVersion != 1 || string.IsNullOrWhiteSpace(contract.SnapshotHash))
        { missing.Add("contract_price_snapshot_missing"); return []; }
        if (!ContractChargeSnapshot.IsIntact(contract) || snapshot.AgreedRent != contract.MonthlyRent || snapshot.Charges is null)
        { missing.Add("contract_price_snapshot_invalid"); return []; }

        var charges = new List<PolicyDto>();
        foreach (var c in snapshot.Charges)
        {
            var category = (ChargeCategory)c.Category;
            if (category == ChargeCategory.Rent) continue;
            if (!Enum.IsDefined(category) || !Enum.IsDefined((ChargingMethod)c.Method) ||
                c.Rate < 0 || c.Version < 1 || c.PolicyId == Guid.Empty || string.IsNullOrWhiteSpace(c.ChargeCode))
            { missing.Add("contract_price_snapshot_invalid"); return []; }
            var method = (ChargingMethod)c.Method;
            if (!PropertyRules.ValidCharge(category, method, c.ChargeCode))
            { missing.Add("contract_price_snapshot_invalid"); return []; }
            charges.Add(new(c.PolicyId, locationId, contract.RoomId, category, c.ChargeCode, string.IsNullOrWhiteSpace(c.Name) ? c.ChargeCode : c.Name,
                method, c.Rate, c.EffectiveFrom, c.EffectiveTo, c.Version));
        }
        charges.Add(new(Guid.Empty, locationId, contract.RoomId, ChargeCategory.Rent, "RENT", "Tiền thuê theo hợp đồng đại diện",
            ChargingMethod.FixedPerRoomPerMonth, snapshot.AgreedRent, contract.StartDate, contract.EndDate, 0));
        if (charges.GroupBy(c => c.ChargeCode, StringComparer.OrdinalIgnoreCase).Any(g => g.Count() != 1))
        { missing.Add("contract_price_snapshot_invalid"); return []; }
        foreach (var category in new[] { ChargeCategory.Electricity, ChargeCategory.Water })
            if (charges.Count(c => c.Category == category) != 1) missing.Add("rate_" + category);
        return charges.OrderBy(c => c.ChargeCode, StringComparer.Ordinal).ToArray();
    }

    public static bool Equivalent(IReadOnlyList<PolicyDto> left, IReadOnlyList<PolicyDto> right) =>
        left.Select(c => (c.ChargeCode, c.Category, c.Method, c.Rate)).SequenceEqual(
            right.Select(c => (c.ChargeCode, c.Category, c.Method, c.Rate)));

    public static string FlatSnapshot(PolicyDto policy, BillingSchedule schedule, decimal quantity, decimal amount) =>
        JsonSerializer.Serialize(new
        {
            kind = "FlatMeteredIncrement/v1",
            policyId = policy.Id,
            policyVersion = policy.Version,
            rate = policy.Rate,
            rounding = schedule.Rounding,
            quantity,
            amount
        });
}
