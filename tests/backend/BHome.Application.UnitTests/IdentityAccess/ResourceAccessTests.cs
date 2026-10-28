using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

public sealed class ResourceAccessTests
{
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly IStaffLocationAccess assignments = Substitute.For<IStaffLocationAccess>();

    [Fact]
    public async Task CancelledRequestDoesNotEvaluateOrGrantScope()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new ResourceAccess(user, assignments)
            .CanAccessAsync(new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), null), [Roles.Staff], cancellation.Token));
        await assignments.DidNotReceiveWithAnyArgs().IsAssignedAsync(default, default, default, default);
    }

    [Fact]
    public async Task AnonymousIsDenied()
    {
        var access = new ResourceAccess(user, assignments);
        Assert.False(await access.CanAccessAsync(new ResourceScope(Guid.NewGuid(), null, null), Roles.All));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OwnerCanOnlyAccessOwnChain(bool ownsChain)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Roles.Owner).Returns(true);
        var access = new ResourceAccess(user, assignments);
        Assert.Equal(ownsChain, await access.CanAccessAsync(new ResourceScope(ownsChain ? id : Guid.NewGuid(), null, null), [Roles.Owner]));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task StaffMustHaveServerSideLocationAssignment(bool assigned)
    {
        var id = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var location = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Roles.Staff).Returns(true);
        assignments.IsAssignedAsync(id, owner, location, Arg.Any<CancellationToken>()).Returns(assigned);
        Assert.Equal(assigned, await new ResourceAccess(user, assignments).CanAccessAsync(new ResourceScope(owner, location, null), [Roles.Staff]));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TenantCanOnlyAccessOwnData(bool ownsData)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(Roles.Tenant).Returns(true);
        Assert.Equal(ownsData, await new ResourceAccess(user, assignments).CanAccessAsync(
            new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), ownsData ? id : Guid.NewGuid()), [Roles.Tenant]));
    }

    [Theory]
    [InlineData(Roles.Owner)]
    [InlineData(Roles.Staff)]
    public async Task AdditionalTenantRoleCannotBypassAnotherOperationsScope(string operationRole)
    {
        var id = Guid.NewGuid();
        user.UserId.Returns(id);
        user.IsInRole(operationRole).Returns(true);
        user.IsInRole(Roles.Tenant).Returns(true);
        var scope = new ResourceScope(Guid.NewGuid(), Guid.NewGuid(), id);
        Assert.False(await new ResourceAccess(user, assignments).CanAccessAsync(scope, [operationRole]));
    }
}
