using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.UnitTests.Billing;

public sealed class PersonMonthOccupancyTests
{
    private static readonly DateOnly Period = new(2026, 11, 1);
    private static readonly PolicyDto Fee = new(Guid.NewGuid(), Guid.NewGuid(), null, ChargeCategory.ServiceFee,
        "CLEANING", "Synthetic cleaning", ChargingMethod.FixedPerPersonPerMonth, 100001m, Period, null, 1);

    private static Contract Tenancy(Guid representative, DateOnly start, DateOnly end, params ContractResident[] residents) =>
        new() { RepresentativeResidentId = representative, StartDate = start, EndDate = end, Residents = residents.ToList() };
    private static ContractResident Member(Guid id, DateOnly from, DateOnly? to = null) =>
        new() { ResidentId = id, ResidenceFrom = from, ResidenceTo = to };

    [Theory]
    [InlineData(PartialMonthRule.FullMonth, 200002)]
    [InlineData(PartialMonthRule.OccupiedCalendarDays, 150002)]
    public void DistinctResidentsAndDailyOccupancyDetermineTheFee(PartialMonthRule rule, decimal expected)
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        var first = Tenancy(a, Period.AddDays(-5), Period.AddMonths(1),
            Member(a, Period.AddDays(-5)), Member(b, Period.AddDays(15)));
        var overlap = Tenancy(b, Period.AddDays(15), Period.AddMonths(1), Member(b, Period.AddDays(15)));
        var people = PersonMonthOccupancy.Read(Period, [first, overlap]);
        Assert.True(people.IsComplete); Assert.Equal(2, people.ResidentCount); Assert.Equal(45, people.PersonDays);
        var result = FixedChargeCalculation.Calculate(Period, Fee, new() { PartialMonth = rule }, "signed", 30, [], people);
        Assert.Empty(result.MissingInputs); Assert.Equal(expected, result.Amount);
        Assert.Equal(2, result.Source.ResidentCount); Assert.Equal(45, result.Source.PersonDays);
    }

    [Fact]
    public void AdjacentRenewalAndDepartureAreClippedAndCoverageBillsOnlyTheIncrement()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        var early = Tenancy(a, Period.AddDays(-5), Period.AddDays(14), Member(a, Period.AddDays(-5)));
        var renewal = Tenancy(a, Period.AddDays(15), Period.AddMonths(1),
            Member(a, Period.AddDays(15)), Member(b, Period.AddDays(15), Period.AddDays(24)));
        renewal.ActualEndDate = Period.AddDays(24);
        var schedule = new BillingSchedule { PartialMonth = PartialMonthRule.OccupiedCalendarDays };
        var initial = FixedChargeCalculation.Calculate(Period, Fee, schedule, "signed", 15, [],
            PersonMonthOccupancy.Read(Period, [early]));
        var people = PersonMonthOccupancy.Read(Period, [early, renewal]);
        Assert.Equal(2, people.ResidentCount); Assert.Equal(35, people.PersonDays);
        var next = FixedChargeCalculation.Calculate(Period, Fee, schedule, "signed", 25, [new(Guid.NewGuid(), initial.Source)], people);
        Assert.Empty(next.MissingInputs); Assert.Equal(66667m, next.Amount);
        Assert.Equal(116668m, next.Source.CumulativePricedAmount);
        var replay = FixedChargeCalculation.Calculate(Period, Fee, schedule, "signed", 25, [new(Guid.NewGuid(), next.Source)], people);
        Assert.Equal(0m, replay.Amount);
        var changed = FixedChargeCalculation.Calculate(Period, Fee with { Rate = 200000m }, schedule, "signed", 25, [new(Guid.NewGuid(), next.Source)], people);
        Assert.Null(changed.Amount); Assert.Contains("fixed_charge_policy_changed", changed.MissingInputs);
    }

    [Fact]
    public void MissingResidentMembershipCannotBeReplacedWithRoomCapacityOrOnePerson()
    {
        var a = Guid.NewGuid();
        var missing = PersonMonthOccupancy.Read(Period, [Tenancy(a, Period, Period.AddDays(29))]);
        Assert.False(missing.IsComplete);
        var result = FixedChargeCalculation.Calculate(Period, Fee, new(), "signed", 30, [], missing);
        Assert.Null(result.Amount); Assert.Contains("fixed_charge_resident_occupancy_required", result.MissingInputs);
    }
}
