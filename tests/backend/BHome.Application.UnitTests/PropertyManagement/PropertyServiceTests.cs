using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
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
    [InlineData(ChargeCategory.Rent, true, false)]
    [InlineData(ChargeCategory.Electricity, true, false)]
    [InlineData(ChargeCategory.Water, true, true)]
    [InlineData(ChargeCategory.ServiceFee, true, true)]
    [InlineData(ChargeCategory.Rent, false, false)]
    [InlineData(ChargeCategory.Electricity, false, true)]
    [InlineData(ChargeCategory.Water, false, false)]
    [InlineData(ChargeCategory.ServiceFee, false, true)]
    public async Task FlatPriceSuccessorPreservesSealedContractPricesAndRejectsMissingSnapshot(ChargeCategory category, bool intact, bool locationScope)
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address", IsActive = true };
        var room = new Room { LocationId = location.Id };
        var old = new BillingPolicy
        {
            LocationId = location.Id,
            RoomId = locationScope ? null : room.Id,
            Category = category,
            ChargeCode = category == ChargeCategory.ServiceFee ? "INTERNET" : category.ToString().ToUpperInvariant(),
            Name = category.ToString(),
            Method = category is ChargeCategory.Electricity or ChargeCategory.Water ? ChargingMethod.Metered : ChargingMethod.FixedPerRoomPerMonth,
            Rate = category == ChargeCategory.Rent ? 3000000 : category == ChargeCategory.Electricity ? 3500 : category == ChargeCategory.Water ? 15000 : 100000,
            EffectiveFrom = new(2026, 1, 1)
        };
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = Guid.NewGuid(),
            TenantUserId = Guid.NewGuid(),
            RepresentativeResidentId = Guid.NewGuid(),
            Status = ContractStatus.Active,
            StartDate = new(2026, 1, 1),
            EndDate = new(2026, 12, 31),
            RentAmount = 3000000,
            Terms = "Synthetic"
        };
        HoldingPriceCharge Charge(Guid id, ChargeCategory category, string code, ChargingMethod method, decimal rate) =>
            new(id, code, (int)category, (int)method, rate, contract.StartDate, null, 1) { Name = code };
        HoldingPriceCharge[] defaults = [Charge(Guid.NewGuid(), ChargeCategory.Rent, "RENT", ChargingMethod.FixedPerRoomPerMonth, contract.RentAmount),
            Charge(Guid.NewGuid(), ChargeCategory.Electricity, "ELECTRICITY", ChargingMethod.Metered, 3500),
            Charge(Guid.NewGuid(), ChargeCategory.Water, "WATER", ChargingMethod.Metered, 15000),
            Charge(Guid.NewGuid(), ChargeCategory.ServiceFee, "INTERNET", ChargingMethod.FixedPerRoomPerMonth, 100000)];
        var charges = defaults.Select(c => c.Category == (int)category
            ? Charge(old.Id, old.Category, old.ChargeCode, old.Method, old.Rate) with { PolicyLocationId = location.Id, PolicyRoomId = old.RoomId }
            : c).ToArray();
        if (intact)
        {
            contract.AgreedPriceSnapshot = System.Text.Json.JsonSerializer.Serialize(new HoldingPriceSnapshot(contract.RentAmount, 0, contract.StartDate, contract.EndDate, default, "Synthetic", BeforeVietnamMidnight, charges) { SnapshotVersion = 1 });
            contract.SnapshotHashOrEmpty = ContractDocumentSnapshot.Hash(new ContractDocument(contract.Id, room.Id, contract.OwnerSignerId, contract.TenantUserId.Value,
                contract.RepresentativeResidentId, [], contract.StartDate, contract.EndDate, contract.RentAmount, 0, null, 0, contract.Terms, "")
            { AgreedCharges = charges });
        }
        var snapshot = contract.AgreedPriceSnapshot;
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        repository.FindAsync<BillingPolicy>(old.Id, default).Returns(old);
        repository.RoomInLocationAsync(room.Id, location.Id, default).Returns(true);
        repository.HasBindingPriceContractAsync(room.Id, default).Returns(true);
        repository.BindingPriceContractsAsync(room.Id, default).Returns(new[] { contract });
        repository.BindingPriceContractsForLocationsAsync(Arg.Any<Guid[]>(), default)
            .Returns(new[] { new ScopedPriceContract(location.Id, null, contract) });
        repository.PolicyLineagesAsync(Arg.Any<Guid[]>(), default).Returns(new Dictionary<Guid, PolicyLineage>());
        repository.WithLocationLockAsync(location.Id, Arg.Any<Func<Task<PolicyDto>>>(), default).Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var input = new PolicyWrite(location.Id, old.RoomId, old.Category, old.ChargeCode, old.Name, old.Method, old.Rate + 500, new(2026, 11, 1), null);
        if (!intact)
        {
            Assert.Equal("contract_price_snapshot_required_for_successor", (await Assert.ThrowsAsync<PropertyException>(() => service.ReplacePolicyAsync(old.Id, new(input, 1), default))).Code);
            Assert.Null(old.EffectiveTo); Assert.Equal(1, old.Version);
            repository.DidNotReceive().Add(Arg.Any<BillingPolicy>());
        }
        else
        {
            var result = await service.ReplacePolicyAsync(old.Id, new(input, 1), default);
            Assert.Equal(input.Rate, result.Rate); Assert.Equal(new DateOnly(2026, 10, 31), old.EffectiveTo);
            Assert.Equal(old.Id, result.FamilyId); Assert.Equal(2, result.Edition); Assert.Equal(old.Id, result.PreviousPolicyId);
            Assert.Equal(snapshot, contract.AgreedPriceSnapshot);
            var missing = new List<string>();
            Assert.Equal(old.Rate, ContractBillingPrices.Read(contract, location.Id, missing).Single(x => x.ChargeCode == old.ChargeCode).Rate);
            Assert.Empty(missing);
            var persisted = await service.GetPolicyAsync(old.Id, default);
            Assert.Equal(contract.EndDate, persisted.LastContractEndDate); Assert.Equal(1, persisted.BindingContractCount);
            Assert.False(persisted.CanEditInPlace);
        }
    }

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
        repository.ActiveRoomTypeExistsAsync(location.Id, roomType.Id, default)
            .Returns(true);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RoomDto>>>(), default)
            .Returns(call => call.Arg<Func<Task<RoomDto>>>()());

        var result = await service.SaveRoomAsync(null,
            new RoomWrite(location.Id, "A-01", "1", 2, RoomTypeId: roomType.Id), default);

        Assert.Equal(roomType.Id, result.RoomTypeId);
        repository.Received(1).Add(Arg.Is<Room>(room => room.RoomTypeId == roomType.Id));
    }

    // Retain duplicate-number coverage through the supported configured-room workflow.
    [Fact]
    public async Task BulkRoomCreationRejectsDuplicateNumbersBeforeAddingRows()
    {
        var (properties, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address", IsActive = true };
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        var shared = Substitute.For<ISharedConfigurationStore>();
        shared.TransactionAsync(Arg.Any<Guid[]>(), Arg.Any<Func<Task<BulkRoomResult>>>(), default, false)
            .Returns(call => call.Arg<Func<Task<BulkRoomResult>>>()());
        var actor = Substitute.For<ICurrentUser>();
        actor.UserId.Returns(Guid.NewGuid());
        actor.IsInRole(Roles.Owner).Returns(true);
        var service = new LocationSetupService(shared, Substitute.For<ISetupWorkspaceStore>(), null!, null!,
            properties, null!, null!, actor, new FixedClock(BeforeVietnamMidnight));
        var defaultsId = Guid.NewGuid();
        var input = new ConfiguredRoomsInput([new("A-01", "1", defaultsId, 1, 2500000),
            new(" a-01 ", "1", defaultsId, 1, 2500000)], new DateOnly(2026, 10, 29));

        var error = await Assert.ThrowsAsync<PropertyException>(() =>
            service.CreateConfiguredRoomsAsync(location.Id, input, Guid.NewGuid(), default));

        Assert.Equal("duplicate_room_number", error.Code);
        repository.DidNotReceive().Add(Arg.Any<Room>());
        await shared.DidNotReceive().SaveOperationAsync(Arg.Any<SharedOperation>(), default);
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
    [InlineData(true)]
    [InlineData(false)]
    public async Task RoomSpecificFeeWritesRespectBindingContractButLocationOfferRemainsEditable(bool locked)
    {
        var (service, repository) = Create(Roles.Owner, BeforeVietnamMidnight);
        var location = new Location("Synthetic") { Address = "Synthetic Address", IsActive = true };
        var room = new Room { LocationId = location.Id };
        repository.FindAsync<Location>(location.Id, default).Returns(location);
        repository.RoomInLocationAsync(room.Id, location.Id, default).Returns(true);
        repository.HasBindingPriceContractAsync(room.Id, default).Returns(locked);
        repository.WithLocationLockAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<PolicyDto>>>(), default)
            .Returns(call => call.Arg<Func<Task<PolicyDto>>>()());
        var input = new PolicyWrite(location.Id, room.Id, ChargeCategory.Water, "WATER", "Water",
            ChargingMethod.Metered, 15000, new(2026, 10, 30), null);
        var existing = new BillingPolicy
        {
            LocationId = location.Id,
            RoomId = room.Id,
            Category = input.Category,
            ChargeCode = input.ChargeCode,
            Name = input.Name,
            Method = input.Method,
            Rate = 10000,
            EffectiveFrom = new(2026, 10, 31)
        };
        repository.FindAsync<BillingPolicy>(existing.Id, default).Returns(existing);
        if (locked)
        {
            var error = await Assert.ThrowsAsync<PropertyException>(() => service.CreatePolicyAsync(input, default));
            Assert.Equal("room_pricing_locked_by_contract", error.Code);
            Assert.Equal("room_pricing_locked_by_contract", (await Assert.ThrowsAsync<PropertyException>(() => service.UpdateFuturePolicyAsync(existing.Id, new(input, 1), default))).Code);
            Assert.Equal("contract_price_snapshot_required_for_successor", (await Assert.ThrowsAsync<PropertyException>(() => service.ReplacePolicyAsync(existing.Id, new(input with { EffectiveFrom = new(2026, 11, 1) }, 1), default))).Code);
            Assert.Equal("room_pricing_locked_by_contract", (await Assert.ThrowsAsync<PropertyException>(() => service.EndPolicyAsync(existing.Id, new(new(2026, 11, 1), 1, "Synthetic reason"), default))).Code);
            Assert.Equal(10000, existing.Rate);
            Assert.Equal(1, existing.Version);
            repository.DidNotReceive().Add(Arg.Any<BillingPolicy>());
        }
        else Assert.Equal(15000, (await service.CreatePolicyAsync(input, default)).Rate);
        Assert.Equal(15000, (await service.CreatePolicyAsync(input with { RoomId = null }, default)).Rate);
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
