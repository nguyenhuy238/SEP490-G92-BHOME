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
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task EachObligationBlocksStatusAndCapacityChangesEvenWhenRoomAppearsAvailable(int kind)
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address" };
        var room = new Room { LocationId = location.Id, Capacity = 2, Status = RoomStatus.Available };
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        repository.FindAsync<Room>(room.Id, default).Returns(room);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RoomDto>>>(), default)
            .Returns(c => c.Arg<Func<Task<RoomDto>>>()());
        repository.ObligationsAsync(location.Id, room.Id, Arg.Any<DateOnly>(), default)
            .Returns(new RoomObligations(kind == 0, kind == 1, kind == 2, kind == 3));
        var input = new RoomWrite(location.Id, "A-1", null, 2, RoomStatus.Unavailable, 1);
        Assert.Equal("room_status_controlled", (await Assert.ThrowsAsync<PropertyException>(() => service.SaveRoomAsync(room.Id, input, default))).Code);
        Assert.Equal("room_has_obligations", (await Assert.ThrowsAsync<PropertyException>(() => service.SaveRoomAsync(room.Id,
            input with { Status = RoomStatus.Available, Capacity = 3 }, default))).Code);
        Assert.Equal(1, room.Version); Assert.Equal(RoomStatus.Available, room.Status);
        repository.DidNotReceive().Audit(Arg.Any<PropertyChange>());
    }

    [Fact]
    public async Task ContractVersionInvalidatesOldPropertyRequestBeforeStatusChecks()
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address" };
        var room = new Room { LocationId = location.Id, Status = RoomStatus.Occupied, Version = 2 };
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        repository.FindAsync<Room>(room.Id, default).Returns(room);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RoomDto>>>(), default).Returns(c => c.Arg<Func<Task<RoomDto>>>()());
        var error = await Assert.ThrowsAsync<PropertyException>(() => service.SaveRoomAsync(room.Id,
            new(location.Id, "Old name", null, 1, RoomStatus.Available, 1), default));
        Assert.Equal("stale_version", error.Code); Assert.Equal(2, room.Version);
        repository.DidNotReceive().Audit(Arg.Any<PropertyChange>());
    }

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

    [Fact]
    public async Task OwnerCanCreateRoomLinkedToActiveRoomTypeInSameLocation()
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address" };
        var roomType = new RoomType
        {
            LocationId = location.Id,
            Name = "Studio",
            DefaultCapacity = 2,
            IsActive = true
        };
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        repository.AnyAsync<RoomType>(Arg.Any<System.Linq.Expressions.Expression<Func<RoomType, bool>>>(), default)
            .Returns(true);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RoomDto>>>(), default)
            .Returns(call => call.Arg<Func<Task<RoomDto>>>()());

        var result = await service.SaveRoomAsync(null,
            new RoomWrite(location.Id, "A-01", "1", 2, RoomTypeId: roomType.Id), default);

        Assert.Equal(roomType.Id, result.RoomTypeId);
        repository.Received(1).Add(Arg.Is<Room>(room => room.RoomTypeId == roomType.Id));
    }

    [Fact]
    public async Task BulkRoomCreationRejectsDuplicateNumbersBeforeAddingRows()
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<BulkRoomResult>>>(), default)
            .Returns(call => call.Arg<Func<Task<BulkRoomResult>>>()());
        var location = new Location("Synthetic") { Address = "Synthetic Address", IsActive = true };
        var locationId = location.Id;
        var typeId = Guid.NewGuid();
        repository.FindAsync<Location>(locationId, default).Returns(location);

        var error = await Assert.ThrowsAsync<PropertyException>(() => service.BulkCreateRoomsAsync(
            new BulkRoomWrite(locationId,
            [new("A-01", "1", typeId), new(" a-01 ", "1", typeId)]), default));

        Assert.Equal("duplicate_room_number", error.Code);
        repository.DidNotReceive().Add(Arg.Any<Room>());
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
            new(Guid.NewGuid(), null, ChargeCategory.Rent, "RENT", "Rent", ChargingMethod.FixedPerRoomPerMonth,
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
        var location = new Location("Synthetic") { Address = "Synthetic Address" };
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
        var input = new PolicyWrite(location.Id, null, ChargeCategory.Rent, "RENT", "Rent",
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
        var location = new Location("Synthetic") { Address = "Synthetic Address" };
        repository.FindAsync<Location>(location.Id, Arg.Any<CancellationToken>()).Returns(location);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<PolicyDto>>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var input = new PolicyWrite(location.Id, null, ChargeCategory.Rent, "RENT", "Rent",
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
