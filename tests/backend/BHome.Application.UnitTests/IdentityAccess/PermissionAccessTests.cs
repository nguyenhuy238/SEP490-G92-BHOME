using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

public sealed class PermissionAccessTests
{
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly IStaffLocationAccess assignments = Substitute.For<IStaffLocationAccess>();
    private PermissionAccess Access => new(user, new ResourceAccess(user, assignments));

    [Theory]
    [InlineData(Roles.Owner, true)]
    [InlineData(Roles.Staff, false)]
    [InlineData(Roles.Tenant, false)]
    [InlineData("Administrator", false)]
    [InlineData("Guest", false)]
    public void ServicePermissionUsesFixedRoleGrants(string role, bool expected)
    {
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(role).Returns(true);
        Assert.Equal(expected, Access.HasPermission(Permissions.StaffAccounts.Manage));
    }

    [Fact]
    public void AnonymousOrEmptyIdentityIsDeniedEvenIfItHasRoleClaims()
    {
        user.IsInRole(Roles.Owner).Returns(true);
        Assert.False(Access.HasPermission(Permissions.StaffAccounts.Manage));
        user.UserId.Returns(Guid.Empty);
        Assert.False(Access.HasPermission(Permissions.StaffAccounts.Manage));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("*")]
    [InlineData("unregistered.action")]
    public async Task UnknownPermissionCannotReachAssignmentChecks(string? permission)
    {
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Arg.Any<string>()).Returns(true);
        Assert.False(Access.HasPermission(permission));
        Assert.False(await Access.CanAccessAsync(permission, new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), null)));
        await assignments.DidNotReceiveWithAnyArgs().IsAssignedAsync(default, default, default, default);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OwnerFunctionPermissionDoesNotGrantAnotherOwnersData(bool ownsResource)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Roles.Owner).Returns(true);
        Assert.True(Access.HasPermission(Permissions.Rooms.Manage));
        Assert.Equal(ownsResource, await Access.CanAccessAsync(Permissions.Rooms.Manage,
            new ResourceScope(ownsResource ? id : Guid.NewGuid(), Guid.NewGuid(), null)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task StaffFunctionPermissionStillRequiresCurrentLocationAssignment(bool assigned)
    {
        var staff = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var location = Guid.NewGuid();
        user.UserId.Returns(staff);
        user.IsInRole(Roles.Staff).Returns(true);
        assignments.IsAssignedAsync(staff, owner, location, Arg.Any<CancellationToken>()).Returns(assigned);
        Assert.True(Access.HasPermission(Permissions.MeterReadings.Confirm));
        Assert.Equal(assigned, await Access.CanAccessAsync(Permissions.MeterReadings.Confirm, new ResourceScope(owner, location, null)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TenantPermissionStillRequiresOwnTenancy(bool ownTenancy)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Roles.Tenant).Returns(true);
        Assert.Equal(ownTenancy, await Access.CanAccessAsync(Permissions.InvoiceAdjustments.Request,
            new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), ownTenancy ? id : Guid.NewGuid())));
    }

    [Theory]
    [InlineData(Roles.Owner, Permissions.Contracts.Activate)]
    [InlineData(Roles.Staff, Permissions.MeterReadings.Confirm)]
    public async Task AdditionalTenantRoleCannotBypassTheOperationsScope(string role, string permission)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(role).Returns(true);
        user.IsInRole(Roles.Tenant).Returns(true);
        Assert.True(Access.HasPermission(permission));
        Assert.False(await Access.CanAccessAsync(permission, new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), id)));
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("location")]
    [InlineData("tenant")]
    public async Task InvalidResourceIdentifiersNeverGrantAccess(string invalid)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Arg.Any<string>()).Returns(true);
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var scope = new ResourceScope(invalid == "owner" ? Guid.Empty : id,
            invalid == "location" ? Guid.Empty : Guid.NewGuid(), invalid == "tenant" ? Guid.Empty : id);
        Assert.False(await Access.CanAccessAsync(Permissions.Rooms.View, scope));
        await assignments.DidNotReceiveWithAnyArgs().IsAssignedAsync(default, default, default, default);
    }

    [Fact]
    public async Task LocationAssignmentDoesNotGrantStaffTheOwnerInvoiceView()
    {
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Roles.Staff).Returns(true);
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var scope = new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), null);
        Assert.False(Access.HasPermission(Permissions.Invoices.View));
        Assert.False(await Access.CanAccessAsync(Permissions.Invoices.View, scope));
        await assignments.DidNotReceiveWithAnyArgs().IsAssignedAsync(default, default, default, default);
        Assert.True(await Access.CanAccessAsync(Permissions.Invoices.ViewOperational, scope));
    }

    [Fact]
    public async Task CancellationStopsScopeEvaluation()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Access.CanAccessAsync(Permissions.MeterReadings.Confirm,
            new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), null), cancellation.Token));
        await assignments.DidNotReceiveWithAnyArgs().IsAssignedAsync(default, default, default, default);
    }
}
