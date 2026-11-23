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
    [Fact]
    public async Task TenantProgressProjectsOnlyPublicMilestonesAndHidesInternalWorkOrderData()
    {
        var user = new User(Roles.Tenant);
        var repository = Substitute.For<IIncidentRepository>();
        repository.ActiveRoleAsync(user.UserId!.Value, Roles.Tenant, default).Returns(true);
        var report = new IncidentReport
        {
            ReporterId = user.UserId.Value, ReporterRole = Roles.Tenant,
            Status = IncidentStatus.InProgress, LocationId = Guid.NewGuid()
        };
        repository.IncidentAsync(report.Id, default).Returns(report);
        repository.HistoryAsync(report.Id, Arg.Any<IncidentScope>(), 1, 100, default).Returns(
            new IncidentPage<IncidentActivityView>([
                new(Guid.NewGuid(), null, "reject", "PRIVATE REJECTION NOTE", DateTimeOffset.UtcNow.AddMinutes(-4), Guid.NewGuid(), "{\"Reason\":\"private\"}"),
                new(Guid.NewGuid(), null, "assigned", "PRIVATE OWNER NOTE", DateTimeOffset.UtcNow.AddMinutes(-3), Guid.NewGuid(), "{\"AssignedStaffId\":\"private\"}")
            ], 1, 100, 2));
        var order = new MaintenanceWorkOrder { IncidentId = report.Id, Status = WorkOrderStatus.InProgress };
        repository.WorkOrdersAsync(report.Id, default).Returns([order]);
        repository.WorkHistoryAsync(order.Id, Arg.Any<IncidentScope>(), 1, 100, default).Returns(
            new IncidentPage<IncidentActivityView>([
                new(Guid.NewGuid(), order.Id, "proposal_submitted", "PRIVATE INSPECTION NOTE", DateTimeOffset.UtcNow.AddMinutes(-2), Guid.NewGuid(), "{\"EstimatedCost\":999999}"),
                new(Guid.NewGuid(), order.Id, "progress", "PRIVATE STAFF PROGRESS", DateTimeOffset.UtcNow.AddMinutes(-1), Guid.NewGuid(), "{\"Vendor\":\"private\"}")
            ], 1, 100, 2));

        var progress = await Service(repository, user).TenantProgressAsync(report.Id, default);

        Assert.Equal("Nhân viên đang sửa chữa", progress.CurrentStep);
        Assert.Equal(4, progress.Events.Count);
        Assert.Contains(progress.Events, item => item.Message == "Báo cáo đã được xem xét và từ chối");
        Assert.Contains(progress.Events, item => item.Message == "Đã giao nhân viên kiểm tra và xử lý");
        Assert.Contains(progress.Events, item => item.Message == "Nhân viên đã kiểm tra thực tế và gửi phương án sửa chữa");
        Assert.Contains(progress.Events, item => item.Message == "Nhân viên đang thực hiện công việc");
        var rendered = string.Join(" ", progress.Events.Select(item => item.Message));
        Assert.DoesNotContain("PRIVATE", rendered);
        Assert.DoesNotContain("999999", rendered);
        Assert.DoesNotContain(order.Id.ToString(), rendered);
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
