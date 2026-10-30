using BHome.Domain.PropertyManagement;

namespace BHome.Domain.UnitTests.PropertyManagement;

public sealed class PropertyRulesTests
{
    [Fact]
    public void UsageRecordsFirstUtcInstantAndDoesNotRewriteItOnRetry()
    {
        var policy = new BillingPolicy();
        var first = new DateTimeOffset(2026, 10, 30, 12, 0, 0, TimeSpan.FromHours(7));
        policy.RecordUsage(first); policy.RecordUsage(first.AddDays(1));
        Assert.Equal(first.ToUniversalTime(), policy.FirstUsedAt);
        Assert.Equal(TimeSpan.Zero, policy.FirstUsedAt!.Value.Offset);
        Assert.Throws<ArgumentOutOfRangeException>(() => new BillingPolicy().RecordUsage(default));
    }

    [Theory]
    [InlineData(RoomStatus.Available, RoomStatus.Unavailable, false, true)]
    [InlineData(RoomStatus.Unavailable, RoomStatus.Available, false, true)]
    [InlineData(RoomStatus.Available, RoomStatus.Unavailable, true, false)]
    [InlineData(RoomStatus.Occupied, RoomStatus.Available, false, false)]
    [InlineData(RoomStatus.OnHold, RoomStatus.Unavailable, false, false)]
    [InlineData(RoomStatus.Available, RoomStatus.Occupied, false, false)]
    [InlineData(RoomStatus.Available, RoomStatus.OnHold, false, false)]
    public void ManualStatusChangesRespectBusinessObligations(RoomStatus current, RoomStatus requested,
        bool residents, bool allowed) => Assert.Equal(allowed, PropertyRules.CanManuallyChange(current, requested, residents));

    [Theory]
    [InlineData(ChargeCategory.Rent, ChargingMethod.FixedPerRoomPerMonth, "RENT", true)]
    [InlineData(ChargeCategory.Rent, ChargingMethod.Metered, "RENT", false)]
    [InlineData(ChargeCategory.Water, ChargingMethod.Metered, "WATER", true)]
    [InlineData(ChargeCategory.Electricity, ChargingMethod.Metered, "ELECTRICITY", true)]
    [InlineData(ChargeCategory.Water, ChargingMethod.FixedPerRoomPerMonth, "WATER", false)]
    [InlineData(ChargeCategory.ServiceFee, ChargingMethod.FixedPerRoomPerMonth, "INTERNET", true)]
    [InlineData(ChargeCategory.ServiceFee, ChargingMethod.FixedPerRoomPerMonth, "RENT", false)]
    [InlineData(ChargeCategory.ServiceFee, ChargingMethod.Metered, "INTERNET", false)]
    public void OnlyApprovedChargeMethodsAndReservedCodesAreAccepted(ChargeCategory category,
        ChargingMethod method, string code, bool valid) => Assert.Equal(valid, PropertyRules.ValidCharge(category, method, code));
}
