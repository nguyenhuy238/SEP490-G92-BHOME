using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class PropertyServiceTests
{
    private static (PropertyService Service, IPropertyRepository Repository) Create(string role, DateTimeOffset now)
    {
        var repository = Substitute.For<IPropertyRepository>();
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(Guid.NewGuid()); user.IsInRole(role).Returns(true);
        var resources = new ResourceAccess(user, Substitute.For<IStaffLocationAccess>());
        return (new(repository, user, new PermissionAccess(user, resources), new FixedClock(now)), repository);
    }
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
    private static readonly DateTimeOffset BeforeVietnamMidnight = new(2026, 10, 29, 16, 59, 59, TimeSpan.Zero);

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task WritesAreDeniedBeforeAnyPersistenceLookup(string role)
    {
        var (service, repository) = Create(role, BeforeVietnamMidnight);
        var exception = await Assert.ThrowsAsync<PropertyException>(() => service.SaveLocationAsync(null,
            new("Test", "Synthetic Address"), default));
        Assert.Equal(403, exception.Status);
        Assert.Empty(repository.ReceivedCalls());
    }
    [Theory]
    [InlineData(0, 20)]
    [InlineData(1, 101)]
    [InlineData(int.MaxValue, 100)]
    public async Task UnboundedOrOverflowingPagesAreRejectedBeforeQuerying(int page, int pageSize)
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var exception = await Assert.ThrowsAsync<PropertyException>(() => service.RoomsAsync(new() { Page = page, PageSize = pageSize }, default));
        Assert.Equal(400, exception.Status); Assert.Empty(repository.ReceivedCalls());
    }
    [Theory]
    [InlineData(-1)]
    [InlineData(100000000000000)]
    public async Task DirectServiceCallsCannotBypassRateBounds(decimal rate)
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<PolicyDto>>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var exception = await Assert.ThrowsAsync<PropertyException>(() => service.CreatePolicyAsync(
            new(Guid.NewGuid(), null, null, ChargeCategory.Rent, "RENT", "Rent", ChargingMethod.FixedPerRoomPerMonth,
                rate, new(2026, 10, 29), null), default));
        Assert.Equal(400, exception.Status);
        repository.DidNotReceive().Add(Arg.Any<BillingPolicy>());
    }

    [Theory]
    [InlineData(16, 59, true)]
    [InlineData(17, 0, false)]
    public async Task FutureEditCannotBecomeEffectiveOnTheNewVietnamBusinessDate(int hour, int minute, bool accepted)
    {
        var (service, repository) = Create(Roles.Owner, new(2026, 10, 29, hour, minute, 0, TimeSpan.Zero));
        var location = new Location("Synthetic") { ChainId = Guid.NewGuid(), Address = "Synthetic Address" };
        var policy = new BillingPolicy
        {
            LocationId = location.Id,
            Category = ChargeCategory.Rent,
            ChargeCode = "RENT",
            Name = "Rent",
            Method = ChargingMethod.FixedPerRoomPerMonth,
            Rate = 100,
            EffectiveFrom = new(2026, 10, 31)
        };
        repository.FindAsync<Location>(location.Id, Arg.Any<CancellationToken>()).Returns(location);
        repository.FindAsync<BillingPolicy>(policy.Id, Arg.Any<CancellationToken>()).Returns(policy);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<PolicyDto>>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var input = new PolicyWrite(location.Id, null, null, ChargeCategory.Rent, "RENT", "Rent",
            ChargingMethod.FixedPerRoomPerMonth, 200, new(2026, 10, 30), null);
        if (accepted)
            Assert.Equal(200, (await service.UpdateFuturePolicyAsync(policy.Id, new(input, 1), default)).Rate);
        else
        {
            var error = await Assert.ThrowsAsync<PropertyException>(() => service.UpdateFuturePolicyAsync(policy.Id, new(input, 1), default));
            Assert.Equal(400, error.Status); Assert.Equal(100, policy.Rate);
        }
    }

    [Theory]
    [InlineData(16, 59, true)]
    [InlineData(17, 0, false)]
    public async Task PolicyStartUsesVietnamDateAcrossUtcMidnightBoundary(int hour, int minute, bool accepted)
    {
        var (service, repository) = Create(Roles.Owner, new(2026, 10, 29, hour, minute, 0, TimeSpan.Zero));
        var location = new Location("Synthetic") { ChainId = Guid.NewGuid(), Address = "Synthetic Address" };
        repository.FindAsync<Location>(location.Id, Arg.Any<CancellationToken>()).Returns(location);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<PolicyDto>>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var input = new PolicyWrite(location.Id, null, null, ChargeCategory.Rent, "RENT", "Rent",
            ChargingMethod.FixedPerRoomPerMonth, 100, new(2026, 10, 29), null);
        if (accepted)
            Assert.Equal(input.EffectiveFrom, (await service.CreatePolicyAsync(input, default)).EffectiveFrom);
        else
        {
            var exception = await Assert.ThrowsAsync<PropertyException>(() => service.CreatePolicyAsync(input, default));
            Assert.Equal(400, exception.Status);
            repository.DidNotReceive().Add(Arg.Any<BillingPolicy>());
        }
    }
}
