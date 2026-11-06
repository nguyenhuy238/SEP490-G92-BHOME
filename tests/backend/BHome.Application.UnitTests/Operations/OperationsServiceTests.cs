using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Operations;

public sealed class OperationsServiceTests
{
    private sealed class User(Guid? id, params string[] roles) : ICurrentUser
    {
        public Guid? UserId { get; } = id;
        public bool IsInRole(string role) => roles.Contains(role);
    }

    private static OperationsService Service(IOperationsRepository repository, ICurrentUser user) =>
        new(repository, Substitute.For<IOperationsFiles>(), user,
            new PermissionAccess(user, new ResourceAccess(user, Substitute.For<IStaffLocationAccess>())),
            TimeProvider.System);

    [Fact]
    public async Task Residence_StaffCannotReadWorkflow()
    {
        var repository = Substitute.For<IOperationsRepository>();
        var service = Service(repository, new User(Guid.NewGuid(), Roles.Staff));

        var error = await Assert.ThrowsAsync<OperationsException>(() =>
            service.ResidenceAsync(new ResidenceQuery(), default));

        Assert.Equal(403, error.Status);
        await repository.DidNotReceiveWithAnyArgs().ResidenceAsync(default!, default, default);
    }

    [Fact]
    public async Task Residence_TenantQueryIsForcedToAuthenticatedTenant()
    {
        var tenant = Guid.NewGuid();
        var repository = Substitute.For<IOperationsRepository>();
        repository.ResidenceAsync(Arg.Any<ResidenceQuery>(), tenant, Arg.Any<CancellationToken>())
            .Returns(new OperationsPage<ResidenceTaskView>([], 1, 20, 0));
        var service = Service(repository, new User(tenant, Roles.Tenant));

        await service.ResidenceAsync(new ResidenceQuery(), default);

        await repository.Received(1).ResidenceAsync(Arg.Any<ResidenceQuery>(), tenant, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Residence_TenantCannotOwnerConfirm()
    {
        var repository = Substitute.For<IOperationsRepository>();
        var service = Service(repository, new User(Guid.NewGuid(), Roles.Tenant));

        var error = await Assert.ThrowsAsync<OperationsException>(() => service.ConfirmResidenceAsync(
            Guid.NewGuid(), Guid.NewGuid(), new ResidenceOwnerConfirmation("confirmed"), default));

        Assert.Equal(403, error.Status);
        await repository.DidNotReceiveWithAnyArgs().ConfirmResidenceAsync(default, default, default, default!, default, default);
    }

    [Fact]
    public async Task PublicRead_DoesNotRequireAuthentication()
    {
        var repository = Substitute.For<IOperationsRepository>();
        repository.PublishedLocationsAsync(Arg.Any<CancellationToken>()).Returns([]);
        var service = Service(repository, new User(null));

        var result = await service.PublishedLocationsAsync(default);

        Assert.Empty(result);
    }

    [Fact]
    public async Task RecurringTemplate_StaffCannotManage()
    {
        var repository = Substitute.For<IOperationsRepository>();
        var service = Service(repository, new User(Guid.NewGuid(), Roles.Staff));

        var error = await Assert.ThrowsAsync<OperationsException>(() => service.TemplatesAsync(Guid.NewGuid(), default));

        Assert.Equal(403, error.Status);
    }
}
