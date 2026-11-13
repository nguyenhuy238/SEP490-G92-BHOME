using System.Text.Json;
using BHome.Application.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class SharedFeeValidationTests
{
    private readonly SharedDataValidator validator = new(Substitute.For<ISharedConfigurationStore>());

    private static JsonElement Fee(string category, string code, string method, string unit) =>
        JsonSerializer.SerializeToElement(new { category, chargeCode = code, method, unit, referenceRate = 1000, scope = "Location", effectiveFrom = "2026-12-01" });

    [Theory]
    [InlineData("Rent", "rent", "FixedPerRoomPerMonth", "VND / th\u00e1ng", "VND/month")]
    [InlineData("Electricity", "electricity", "Metered", "VND / kWh", "kWh")]
    [InlineData("Water", "water", "Metered", "m3", "m\u00b3")]
    [InlineData("ServiceFee", "internet", "FixedPerRoomPerMonth", "VND/month", "VND/month")]
    [InlineData("ServiceFee", "cleaning", "FixedPerPersonPerMonth", "VND/person/month", "VND/person/month")]
    [InlineData("ServiceFee", "cleaning", "FixedPerPersonPerMonth", "VND / ng\u01b0\u1eddi / th\u00e1ng", "VND/person/month")]
    public async Task NormalizesSupportedUnits(string category, string code, string method, string unit, string expected)
    {
        var result = await validator.ValidateAsync("fee-templates", Fee(category, code, method, unit), default);
        Assert.Equal(expected, result.GetProperty("unit").GetString());
        Assert.Equal(code.ToUpperInvariant(), result.GetProperty("chargeCode").GetString());
    }

    [Theory]
    [InlineData("Water", "WATER", "Metered", "kWh")]
    [InlineData("Electricity", "ELECTRICITY", "Metered", "VND/month")]
    [InlineData("ServiceFee", "INTERNET", "FixedPerRoomPerMonth", "m3")]
    [InlineData("ServiceFee", "WATER", "FixedPerRoomPerMonth", "VND/month")]
    [InlineData("Water", "WATER", "FixedPerRoomPerMonth", "m3")]
    [InlineData("ServiceFee", "INTERNET", "Metered", "kWh")]
    [InlineData("ServiceFee", "CLEANING", "FixedPerPersonPerMonth", "VND/month")]
    [InlineData("ServiceFee", "CLEANING", "FixedPerRoomPerMonth", "VND/person/month")]
    [InlineData("Rent", "RENT", "FixedPerPersonPerMonth", "VND/person/month")]
    public async Task RejectsIncompatibleCharges(string category, string code, string method, string unit) =>
        await Assert.ThrowsAsync<PropertyException>(() => validator.ValidateAsync("fee-templates", Fee(category, code, method, unit), default));
}
