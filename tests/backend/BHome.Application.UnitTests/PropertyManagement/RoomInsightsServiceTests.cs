using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class RoomInsightsServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 5, 2, 0, 0, TimeSpan.Zero);
    private static (PropertyService Service, IPropertyRepository Property, IRoomInsightsRepository Insights,
        IStaffLocationAccess Assignments, Guid Actor, IAdministrativeContractReadiness ContractReadiness) Create(string role)
    {
        var property = Substitute.For<IPropertyRepository>();
        var insights = Substitute.For<IRoomInsightsRepository>();
        var user = Substitute.For<ICurrentUser>();
        var actor = Guid.NewGuid();
        user.UserId.Returns(actor);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
        var assignments = Substitute.For<IStaffLocationAccess>();
        var contractReadiness = Substitute.For<IAdministrativeContractReadiness>();
        contractReadiness.BlockersAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Array.Empty<string>());
        var resources = new ResourceAccess(user, assignments);
        return (new(property, user, new PermissionAccess(user, resources), new FixedClock(), insights, contractReadiness),
            property, insights, assignments, actor, contractReadiness);
    }
    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private static (Location Location, Room Room) Scope(IPropertyRepository property)
    {
        var location = new Location("Synthetic") { IsActive = true };
        var room = new Room { LocationId = location.Id, RoomTypeId = Guid.NewGuid(), Capacity = 3 };
        property.FindAsync<Location>(location.Id, Arg.Any<CancellationToken>()).Returns(location);
        property.FindAsync<Room>(room.Id, Arg.Any<CancellationToken>()).Returns(room);
        return (location, room);
    }
    private static RoomReadinessEvidence Evidence(RoomStatus status = RoomStatus.Available,
        bool rent = true, bool electricity = true, bool water = true, bool electricityBaseline = true,
        bool waterBaseline = true, RoomObligations obligations = default,
        MoveInContractEvidence? contract = null) => new(true, true, status, 3, obligations, rent, 0,
            electricity, water, electricityBaseline, waterBaseline, false, contract);

    [Fact]
    public async Task HoldingNeverClaimsReadyAndSeparatesKnownBlockersFromUnsupportedWorkflow()
    {
        var (service, property, insights, _, _, _) = Create(Roles.Owner);
        var (_, room) = Scope(property);
        insights.ReadinessAsync(room.Id, null, Arg.Any<DateOnly>(), default).Returns(Evidence(rent: false));

        var result = await service.RoomReadinessAsync(room.Id, RoomReadinessPurpose.Holding, null, null, default);

        Assert.Equal("Blocked", result.Status);
        Assert.Contains(result.Blockers, x => x.Code == "RENT_POLICY_MISSING");
        Assert.Contains(result.UnverifiedConditions, x => x.Code == "HOLDING_WORKFLOW_UNSUPPORTED");
        Assert.Empty(result.Warnings);
        property.DidNotReceive().Audit(Arg.Any<PropertyChange>());
    }

    [Fact]
    public async Task ProtectedPendingAndOccupiedRoomAreReportedForHolding()
    {
        var (service, property, insights, _, _, _) = Create(Roles.Owner);
        var (_, room) = Scope(property);
        insights.ReadinessAsync(room.Id, null, Arg.Any<DateOnly>(), default).Returns(Evidence(RoomStatus.Occupied,
            obligations: new(false, false, false, true)));
        var result = await service.RoomReadinessAsync(room.Id, RoomReadinessPurpose.Holding, null, null, default);
        Assert.Contains(result.Blockers, x => x.Code == "ACTIVE_TENANCY_CONFLICT");
        Assert.Contains(result.Blockers, x => x.Code == "PROTECTED_PENDING_CONTRACT");
    }

    [Fact]
    public async Task MoveInReportsMetersBaselinesAndHandoverWithoutTreatingSecondContractAsConflict()
    {
        var (service, property, insights, _, _, contractReadiness) = Create(Roles.Owner);
        var (_, room) = Scope(property); var contractId = Guid.NewGuid();
        var contract = new MoveInContractEvidence(true, true, true, true, 1, 1, true, false, false);
        insights.ReadinessAsync(room.Id, contractId, Arg.Any<DateOnly>(), default).Returns(
            Evidence(RoomStatus.Occupied, electricity: false, waterBaseline: false,
                obligations: new(false, true, true, false), contract: contract));
        contractReadiness.BlockersAsync(contractId, room.Id, default).Returns(["security_deposit_insufficient"]);
        var result = await service.RoomReadinessAsync(room.Id, RoomReadinessPurpose.MoveIn, contractId, null, default);
        Assert.Contains(result.Blockers, x => x.Code == "ELECTRICITY_METER_MISSING");
        Assert.Contains(result.Blockers, x => x.Code == "WATER_BASELINE_MISSING");
        Assert.DoesNotContain(result.Blockers, x => x.Code == "ACTIVE_TENANCY_CONFLICT");
        Assert.Contains(result.Warnings, x => x.Code == "HANDOVER_NOT_CONFIRMED");
        Assert.Contains(result.UnverifiedConditions, x => x.Code == "SAFETY_INCIDENT_DATA_UNAVAILABLE");
        Assert.Contains(result.Blockers, x => x.Code == "SECURITY_DEPOSIT_INSUFFICIENT");
    }

    [Fact]
    public async Task InactiveLocationAndCapacityAreBusinessBlockers()
    {
        var (service, property, insights, _, _, _) = Create(Roles.Owner);
        var (_, room) = Scope(property); var contractId = Guid.NewGuid();
        insights.ReadinessAsync(room.Id, contractId, Arg.Any<DateOnly>(), default).Returns(
            Evidence(contract: new(true, true, true, true, 3, 3, true, false, true)) with
            { LocationActive = false, CurrentOccupantCount = 1 });
        var result = await service.RoomReadinessAsync(room.Id, RoomReadinessPurpose.MoveIn, contractId, null, default);
        Assert.Contains(result.Blockers, x => x.Code == "LOCATION_INACTIVE");
        Assert.Contains(result.Blockers, x => x.Code == "ROOM_CAPACITY_EXCEEDED");
    }

    [Fact]
    public async Task HistoryReturnsPersistedOrderAndSignalsMissingEvidence()
    {
        var (service, property, insights, _, _, _) = Create(Roles.Owner);
        var (_, room) = Scope(property);
        var first = new RoomHistoryEvent(Guid.NewGuid(), "OccupancyEnded", "ContractResident", Now, Guid.NewGuid(), "ended");
        var second = new RoomHistoryEvent(Guid.NewGuid(), "OccupancyStarted", "ContractResident", Now.AddDays(-1), Guid.NewGuid(), "started");
        insights.HistoryAsync(room.Id, Arg.Any<RoomHistoryQuery>(), null, null, default)
            .Returns(new RoomHistoryReadResult([first, second], 2, false));
        var result = await service.RoomHistoryAsync(room.Id, new(), default);
        Assert.Equal([first, second], result.Items);
        Assert.Equal("Partial", result.Completeness);
        Assert.NotEmpty(result.Limitations);
    }

    [Fact]
    public async Task MultipleOccupantsCountOnceAndIncompleteHistoryDoesNotProduceRate()
    {
        var (service, property, insights, _, _, _) = Create(Roles.Owner);
        var (location, room) = Scope(property);
        var snapshot = new OccupancySnapshot(1, 0, 1, 0, 0, 1, 1);
        insights.OccupancyAsync(location.Id, Arg.Any<DateOnly>(), Arg.Any<DateOnly?>(), Arg.Any<DateOnly?>(), default)
            .Returns(new OccupancyReadModel(snapshot, [room.Id], [], [], [], false));
        var result = await service.OccupancySummaryAsync(location.Id,
            new() { From = new(2026, 11, 1), To = new(2026, 11, 5) }, default);
        Assert.Equal(1, result.Snapshot.RoomsWithCurrentVerifiedOccupants);
        Assert.Equal("InsufficientData", result.Historical.Status);
        Assert.Null(result.Historical.OccupancyRate);
    }

    [Fact]
    public void CompleteCalculationDeduplicatesOccupantsExcludesUnavailableAndDoesNotOccupyOnHold()
    {
        var locationId = Guid.NewGuid(); var occupiedRoom = Guid.NewGuid(); var unavailableRoom = Guid.NewGuid();
        var model = new OccupancyReadModel(new(2, 0, 0, 1, 1, 1, 1), [occupiedRoom, unavailableRoom],
            [new(occupiedRoom, new(2026, 11, 1), Now, (int)RoomStatus.OnHold),
             new(unavailableRoom, new(2026, 11, 1), Now, (int)RoomStatus.Unavailable)],
            [new(locationId, new(2026, 11, 1), Now, 1)],
            [new(occupiedRoom, new(2026, 11, 2), new(2026, 11, 2)),
             new(occupiedRoom, new(2026, 11, 2), new(2026, 11, 2))], true);
        var result = PropertyService.CalculateHistorical(new(2026, 11, 1), new(2026, 11, 2), locationId, model);
        Assert.Equal(2, result.RentableRoomDays);
        Assert.Equal(1, result.OccupiedRoomDays);
        Assert.Equal(50m, result.OccupancyRate);
    }

    [Theory]
    [InlineData(Roles.Tenant)]
    [InlineData(Roles.Staff)]
    public async Task TenantAndOutOfScopeStaffCannotAccessAdministrativeInsights(string role)
    {
        var (service, property, insights, assignments, _, _) = Create(role);
        var (_, room) = Scope(property);
        assignments.IsAssignedAsync(Arg.Any<Guid>(), room.LocationId, default).Returns(false);
        var error = await Assert.ThrowsAsync<PropertyException>(() => service.RoomReadinessAsync(room.Id,
            RoomReadinessPurpose.Holding, null, null, default));
        Assert.Equal(role == Roles.Tenant ? 403 : 404, error.Status);
        await insights.DidNotReceiveWithAnyArgs().ReadinessAsync(default, default, default, default);
    }
}
