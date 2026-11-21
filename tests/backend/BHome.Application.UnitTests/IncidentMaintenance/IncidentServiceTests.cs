using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using NSubstitute;

namespace BHome.Application.UnitTests.IncidentMaintenance;

public sealed class IncidentServiceTests
{
    private sealed class User(string role) : ICurrentUser
    {
        public Guid? UserId { get; set; } = Guid.NewGuid();
        public bool IsInRole(string candidate) => role == candidate;
    }
    [Theory]
    [InlineData(Roles.Tenant)]
    [InlineData(Roles.Staff)]
    public async Task NonOwnerCannotReviewEvenWhenCalledWithoutController(string role)
    {
        var user = new User(role); var repository = Substitute.For<IIncidentRepository>();
        var service = Service(repository, user);
        Assert.Equal(403, (await Assert.ThrowsAsync<IncidentException>(() => service.ReviewAsync(Guid.NewGuid(), new(1, "x", "x"), Guid.NewGuid(), default))).Status);
        await repository.DidNotReceiveWithAnyArgs().IncidentAsync(default, default);
    }
    [Fact]
    public async Task DisabledOrRemovedOwnerRoleCannotRelyOnStaleClaims()
    {
        var repository = Substitute.For<IIncidentRepository>(); var user = new User(Roles.Owner);
        var service = Service(repository, user);
        Assert.Equal(403, (await Assert.ThrowsAsync<IncidentException>(() => service.ReviewAsync(Guid.NewGuid(), new(1, "x", "x"), Guid.NewGuid(), default))).Status);
        await repository.DidNotReceiveWithAnyArgs().IncidentAsync(default, default);
    }
    [Fact]
    public async Task CrossTenantReadAndEvidenceFailWithoutStorageAccess()
    {
        var repository = Substitute.For<IIncidentRepository>(); var user = new User(Roles.Tenant); var files = Substitute.For<IIncidentFiles>();
        repository.ActiveRoleAsync(user.UserId!.Value, Roles.Tenant, default).Returns(true);
        var report = new IncidentReport { ReporterId = Guid.NewGuid() };
        repository.IncidentAsync(report.Id, default).Returns(report);
        var service = Service(repository, user, files);
        Assert.Equal(404, (await Assert.ThrowsAsync<IncidentException>(() => service.CopyEvidenceAsync(report.Id, Guid.NewGuid(), Stream.Null, default))).Status);
        await files.DidNotReceiveWithAnyArgs().CopyAsync(default!, default!, default);
    }
    [Fact]
    public void NonAssigneeProjectionHidesAmountsAndVendorButRetainsOperationalState()
    {
        var work = new MaintenanceWorkOrder { EstimatedCost = 900000, ActualCost = 1000000, Vendor = "Private vendor", Status = WorkOrderStatus.Assigned };
        var view = IncidentProjection.Work(work, DateTimeOffset.UtcNow, false);
        Assert.Null(view.ActualCost); Assert.Null(view.EstimatedCost); Assert.Null(view.Vendor); Assert.Equal("Assigned", view.Status);
    }
    [Theory]
    [InlineData(0, 20)]
    [InlineData(1, 101)]
    [InlineData(1000001, 20)]
    public async Task InvalidPaginationCannotReachRepositoryList(int page, int size)
    {
        var repository = Substitute.For<IIncidentRepository>(); var user = new User(Roles.Owner);
        repository.ActiveRoleAsync(user.UserId!.Value, Roles.Owner, default).Returns(true);
        await Assert.ThrowsAsync<IncidentException>(() => Service(repository, user).ListAsync(new() { Page = page, PageSize = size }, default));
        await repository.DidNotReceiveWithAnyArgs().ListAsync(default!, default!, default);
    }
    private static IncidentService Service(IIncidentRepository repository, ICurrentUser user, IIncidentFiles? files = null) =>
        new(repository, user, new PermissionAccess(user, new ResourceAccess(user, Substitute.For<IStaffLocationAccess>())),
            files ?? Substitute.For<IIncidentFiles>(), Substitute.For<IBackgroundJobQueue>(), TimeProvider.System);
}
