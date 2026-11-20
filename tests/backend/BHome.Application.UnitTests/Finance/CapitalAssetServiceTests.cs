using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Finance;

public sealed class CapitalAssetServiceTests
{
    [Fact]
    public async Task VerifiedAssetWithNoPriceAndNoLedger_IsUnpricedNotZeroCost()
    {
        var location = Guid.NewGuid();
        var room = Guid.NewGuid();
        var asset = Guid.NewGuid();
        var repository = Substitute.For<ICapitalAssetRepository>();
        var user = Substitute.For<ICurrentUser>();
        var actor = Guid.NewGuid();
        user.UserId.Returns(actor);
        user.IsInRole(Roles.Owner).Returns(true);
        repository.LocationExistsAsync(location, Arg.Any<CancellationToken>()).Returns(true);
        repository.ReadAsync(location, Arg.Any<CancellationToken>()).Returns(
            (IReadOnlyList<CapitalAssetEntry>)[new(asset, room, null, "Giường", "P.101", true,
                2, null, null, null, false, null, actor, 0m, [], false)]);
        repository.UnreviewedRoomsAsync(location, Arg.Any<CancellationToken>()).Returns(0);
        repository.UnreviewedCommonAsync(location, Arg.Any<IReadOnlyList<CapitalAssetEntry>>(),
            Arg.Any<CancellationToken>()).Returns(0);

        var actual = await new CapitalAssetService(repository, user).ReadAsync(location, default);

        Assert.Equal(1, actual.UnpricedCount);
        Assert.Equal("0", actual.KnownTotal);
        var line = Assert.Single(Assert.Single(actual.Groups).Assets);
        Assert.Null(line.UnitCost);
        Assert.Null(line.TotalCost);
    }
}
