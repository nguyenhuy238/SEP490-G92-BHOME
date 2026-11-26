using BHome.Application.Billing;
using BHome.Domain.TenantContracts;

namespace BHome.Application.UnitTests.Billing;

public sealed class BillingReferenceContractTests
{
    private static readonly DateOnly Period = new(2026, 11, 1);

    private static Contract Contract(DateOnly start, DateOnly end, int createdDay, ContractStatus status = ContractStatus.Active)
    {
        var contract = new Contract
        {
            Kind = ContractKind.Main, Status = status, StartDate = start, EndDate = end,
            ActivatedAt = new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero)
        };
        contract.Stamp(new DateTimeOffset(2026, 10, createdDay, 0, 0, 0, TimeSpan.Zero), true);
        return contract;
    }

    [Fact]
    public void SelectsOldestCreatedContractThatContinuesBeyondPeriod()
    {
        var ended = Contract(Period.AddMonths(-1), Period.AddDays(29), 1);
        var future = Contract(Period.AddMonths(1), Period.AddMonths(3), 2);
        var oldest = Contract(Period.AddDays(27), Period.AddMonths(1), 3);
        var newer = Contract(Period.AddMonths(-1), Period.AddMonths(3), 4);
        Assert.Equal(oldest.Id, BillingReferenceContract.Select(
            new[] { newer, ended, future, oldest }.Select(c => new BillingOccupancy(c, [])), Period)!.Contract.Id);
    }

    [Fact]
    public void UsesEffectiveDatesForLateRunsAndRejectsEarlyTermination()
    {
        var expired = Contract(Period.AddMonths(-1), Period.AddMonths(1), 1, ContractStatus.Expired);
        var terminated = Contract(Period.AddMonths(-1), Period.AddMonths(2), 2, ContractStatus.Terminated);
        terminated.ActualEndDate = Period.AddDays(15);
        Assert.True(BillingReferenceContract.Eligible(expired, Period));
        Assert.False(BillingReferenceContract.Eligible(terminated, Period));
        Assert.Null(BillingReferenceContract.Select([new(terminated, [])], Period));
    }

    [Fact]
    public void EqualCreationTimesUseStableIdOrderAndExcludeNonActivatedContracts()
    {
        var first = Contract(Period, Period.AddMonths(2), 1);
        var second = Contract(Period, Period.AddMonths(2), 1);
        var inactive = Contract(Period, Period.AddMonths(2), 1, ContractStatus.PendingActivation);
        Assert.Equal(new[] { first.Id, second.Id }.Min(), BillingReferenceContract.Select(
            new[] { second, inactive, first }.Select(c => new BillingOccupancy(c, [])), Period)!.Contract.Id);
    }
}
