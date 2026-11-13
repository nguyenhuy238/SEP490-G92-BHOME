using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.UnitTests.Billing;

public sealed class ContractBillingPricesTests
{
    private static Contract SignedContract(int version = 1)
    {
        var c = new Contract { RoomId = Guid.NewGuid(), OwnerSignerId = Guid.NewGuid(), TenantUserId = Guid.NewGuid(), RepresentativeResidentId = Guid.NewGuid(), StartDate = new(2026, 1, 1), EndDate = new(2026, 12, 31), MonthlyRent = 3000000m, Terms = "Synthetic signed terms" };
        c.Residents.Add(new ContractResident { ResidentId = c.RepresentativeResidentId, ResidenceFrom = c.StartDate, Role = ResidentType.Representative });
        HoldingPriceCharge Charge(ChargeCategory category, string code, ChargingMethod method, decimal rate) => new(Guid.NewGuid(), code, (int)category, (int)method, rate, c.StartDate, null, 1) { Name = code };
        HoldingPriceCharge[] charges = [Charge(ChargeCategory.Rent, "RENT", ChargingMethod.FixedPerRoomPerMonth, c.MonthlyRent), Charge(ChargeCategory.Electricity, "ELECTRICITY", ChargingMethod.Metered, 3500), Charge(ChargeCategory.Water, "WATER", ChargingMethod.Metered, 15000), Charge(ChargeCategory.ServiceFee, "INTERNET", ChargingMethod.FixedPerRoomPerMonth, 100000)];
        c.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(c.MonthlyRent, c.RequiredDeposit, c.StartDate, c.EndDate, default, "SyntheticSigned", DateTimeOffset.UtcNow, charges) { SnapshotVersion = version });
        c.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(c.Id, c.RoomId, c.OwnerSignerId, c.TenantUserId.Value, c.RepresentativeResidentId, [c.RepresentativeResidentId], c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, c.SnapshotHash) { AgreedCharges = version == 1 ? charges : null });
        return c;
    }

    [Fact]
    public void SignedRatesRemainAvailableAfterDepartureAndIncludeEveryCharge()
    {
        var c = SignedContract(); c.ActualEndDate = new(2026, 8, 15);
        var missing = new List<string>(); var charges = ContractBillingPrices.Read(c, Guid.NewGuid(), missing);
        Assert.Empty(missing); Assert.Equal(4, charges.Count);
        Assert.Equal(3000000m, charges.Single(x => x.ChargeCode == "RENT").Rate);
        Assert.Equal(3500m, charges.Single(x => x.ChargeCode == "ELECTRICITY").Rate);
        Assert.Equal(15000m, charges.Single(x => x.ChargeCode == "WATER").Rate);
        Assert.Equal(100000m, charges.Single(x => x.ChargeCode == "INTERNET").Rate);
        Assert.Equal(50750m, InvoiceMath.Amount(3500m, 14.5m, 31, 31, PartialMonthRule.FullMonth, VndRounding.AwayFromZero, true));
    }

    [Fact]
    public void ChangingAValidChargeWithoutResigningCannotSupplyBillingRates()
    {
        var c = SignedContract(); var original = ContractChargeSnapshot.Read(c);
        c.AgreedPriceSnapshot = JsonSerializer.Serialize(original with { Charges = original.Charges.Select(x => x.ChargeCode == "ELECTRICITY" ? x with { Rate = 9000m } : x).ToArray() });
        var missing = new List<string>();
        Assert.Empty(ContractBillingPrices.Read(c, Guid.NewGuid(), missing));
        Assert.Contains("contract_price_snapshot_invalid", missing);
    }

    [Fact]
    public void LegacyAndMissingChargeSnapshotsNeverSupplyCurrentPrices()
    {
        var c = SignedContract(0); var missing = new List<string>();
        Assert.Empty(ContractBillingPrices.Read(c, Guid.NewGuid(), missing)); Assert.Contains("contract_price_snapshot_missing", missing);
        c.AgreedPriceSnapshot = "{}"; missing.Clear();
        Assert.Empty(ContractBillingPrices.Read(c, Guid.NewGuid(), missing)); Assert.Contains("contract_price_snapshot_missing", missing);
    }
}
