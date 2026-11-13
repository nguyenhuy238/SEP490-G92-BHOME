using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

// The existing Compact24 agreed-price JSON is the durable source of agreed charges.
// Never reconstruct a missing contract snapshot from mutable property policies.
public static class ContractChargeSnapshot
{
    public static HoldingPriceSnapshot Read(Contract contract)
    {
        if (string.IsNullOrWhiteSpace(contract.AgreedPriceSnapshot) || contract.AgreedPriceSnapshot == "{}")
            throw ContractException.Conflict("contract_price_snapshot_missing");
        HoldingPriceSnapshot? snapshot;
        try { snapshot = JsonSerializer.Deserialize<HoldingPriceSnapshot>(contract.AgreedPriceSnapshot); }
        catch (JsonException) { throw ContractException.Conflict("contract_price_snapshot_invalid"); }
        if (snapshot is null || snapshot.SnapshotVersion is < 0 or > 1 || snapshot.Charges is null ||
            snapshot.Charges.Any(c => c is null || string.IsNullOrWhiteSpace(c.ChargeCode) || c.Rate < 0 ||
                !Enum.IsDefined((ChargeCategory)c.Category) || !Enum.IsDefined((ChargingMethod)c.Method)) ||
            snapshot.Charges.Select(c => c.ChargeCode).Distinct(StringComparer.Ordinal).Count() != snapshot.Charges.Count ||
            snapshot.AgreedRent != contract.MonthlyRent ||
            snapshot.Charges.SingleOrDefault(c => c.ChargeCode == "RENT") is not { } rent ||
            rent.Rate != contract.MonthlyRent || rent.Category != (int)ChargeCategory.Rent ||
            rent.Method != (int)ChargingMethod.FixedPerRoomPerMonth)
            throw ContractException.Conflict("contract_price_snapshot_invalid");
        return snapshot;
    }

    internal static IReadOnlyList<HoldingPriceCharge>? DocumentCharges(Contract contract)
    {
        if (string.IsNullOrWhiteSpace(contract.AgreedPriceSnapshot) || contract.AgreedPriceSnapshot == "{}") return null;
        var snapshot = Read(contract);
        return snapshot.SnapshotVersion == 1 ? snapshot.Charges : null;
    }

    public static bool IsIntact(Contract contract)
    {
        try { return contract.SnapshotHash == ContractDocumentSnapshot.Hash(ContractService.Document(contract)); }
        catch (ContractException) { return false; }
    }

    internal static IReadOnlyList<HoldingPriceCharge>? ViewCharges(Contract contract)
    {
        try { return Read(contract).Charges; }
        catch (ContractException) { return null; }
    }

    internal static bool SameChargeTerms(Contract left, Contract right)
    {
        try
        {
            return Read(left).Charges.OrderBy(c => c.ChargeCode, StringComparer.Ordinal)
                .Select(c => (c.ChargeCode, c.Category, c.Method, c.Rate))
                .SequenceEqual(Read(right).Charges.OrderBy(c => c.ChargeCode, StringComparer.Ordinal)
                    .Select(c => (c.ChargeCode, c.Category, c.Method, c.Rate)));
        }
        catch (ContractException) { return false; }
    }

    internal static IReadOnlyList<HoldingPriceCharge> FromPolicies(Contract contract, IReadOnlyList<PolicyDto> policies)
    {
        var charges = policies.Select(p => new HoldingPriceCharge(p.Id, p.ChargeCode, (int)p.Category, (int)p.Method,
            p.ChargeCode == "RENT" ? contract.MonthlyRent : p.Rate, p.EffectiveFrom, p.EffectiveTo, p.Version) { Name = p.Name }).ToList();
        // The direct contract/renewal API already accepts an agreed rent explicitly.
        // It may have no RENT policy; the contract itself is then the rate source.
        if (!charges.Any(p => p.ChargeCode == "RENT"))
            charges.Add(new(Guid.Empty, "RENT", (int)ChargeCategory.Rent, (int)ChargingMethod.FixedPerRoomPerMonth,
                contract.MonthlyRent, contract.StartDate, null, 0) { Name = "Tiền thuê phòng" });
        return charges.OrderBy(p => p.ChargeCode, StringComparer.Ordinal).ToArray();
    }

    internal static void Store(Contract contract, IReadOnlyList<HoldingPriceCharge> charges, string trigger, DateTimeOffset at)
    {
        contract.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(contract.MonthlyRent,
            contract.RequiredDeposit, contract.StartDate, contract.EndDate, contract.HoldingExpiryAt ?? default,
            trigger, at.ToUniversalTime(), charges) { SnapshotVersion = 1 });
        _ = Read(contract);
    }

    internal static async Task RejectUtilityProfileAsync(IContractRepository repository, Contract contract, CancellationToken t)
    {
        if (await repository.HasUtilityProfileAsync(contract.RoomId, contract.StartDate, contract.EndDate, t))
            throw ContractException.Conflict("contract_utility_profile_requires_review");
    }

    internal static void RequireComplete(Contract contract)
    {
        var charges = Read(contract).Charges;
        foreach (var (code, category) in new[] { ("ELECTRICITY", ChargeCategory.Electricity), ("WATER", ChargeCategory.Water) })
            if (charges.SingleOrDefault(c => c.ChargeCode == code) is not { } charge ||
                charge.Category != (int)category || charge.Method != (int)ChargingMethod.Metered)
                throw ContractException.Conflict("missing_policy_" + code.ToLowerInvariant());
        if (charges.Any(c => c.Category == (int)ChargeCategory.ServiceFee && c.Method != (int)ChargingMethod.FixedPerRoomPerMonth))
            throw ContractException.Conflict("unsupported_contract_charge_unit");
    }

    internal static async Task ValidateBindingAsync(IContractRepository repository, Contract contract, CancellationToken t, bool checkProfile = true)
    {
        RequireComplete(contract);
        if (checkProfile) await RejectUtilityProfileAsync(repository, contract, t);
        var overlapping = await repository.BindingContractsAsync(contract.RoomId, contract.Id, contract.StartDate, contract.EndDate, t);
        if (overlapping.Any(other => other.Id != contract.HoldingContractId &&
            (!IsIntact(other) || !SameChargeTerms(contract, other))))
            throw ContractException.Conflict("room_contract_price_conflict");
    }

    internal static void MarkMainBound(Contract contract, DateTimeOffset at)
    {
        if (contract.Kind is ContractKind.Holding or ContractKind.Addendum) return;
        _ = Read(contract);
        contract.PriceLockedAt ??= at.ToUniversalTime();
        contract.PriceLockTrigger ??= "ContractTermsBound";
    }
}
