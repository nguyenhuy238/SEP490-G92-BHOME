using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using NSubstitute;

namespace BHome.Application.UnitTests.Operations;

public sealed class ResidentAdministrationTests
{
    [Theory]
    [InlineData("Staff")]
    [InlineData("Tenant")]
    public async Task NonOwnerCannotReadOrMutateEvenWhenAnIdentifierIsKnown(string role)
    {
        var repository = Substitute.For<IResidentAdministrationRepository>();
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
        var service = new ResidentAdministrationService(repository, user, TimeProvider.System);
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationsException>(() => service.GetAsync(Guid.NewGuid(), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationsException>(() => service.UpdateAsync(Guid.NewGuid(), new("Label", new string('A', 64), "Reason"), default))).Status);
        Assert.Empty(repository.ReceivedCalls());
    }
    [Fact]
    public async Task InvalidPaginationAndBlankCorrectionCannotReachPersistence()
    {
        var repository = Substitute.For<IResidentAdministrationRepository>();
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole("Owner").Returns(true);
        var service = new ResidentAdministrationService(repository, user, TimeProvider.System);
        await Assert.ThrowsAsync<OperationsException>(() => service.ListAsync(new() { Page = int.MaxValue, PageSize = 100 }, default));
        await Assert.ThrowsAsync<OperationsException>(() => service.UpdateAsync(Guid.NewGuid(), new(" ", new string('A', 64), "Reason"), default));
        Assert.Empty(repository.ReceivedCalls());
    }
}
