using BHome.Domain.IdentityAccess;

namespace BHome.Domain.UnitTests.IdentityAccess;

public sealed class RoleTests
{
    [Fact]
    public void AuthenticatedRolesAreFixedAndExcludePublicGuest()
    {
        Assert.Equal(3, Roles.All.Count);
        Assert.Equal(Roles.All.Count, Roles.All.Distinct().Count());
        Assert.DoesNotContain("Guest", Roles.All);
    }
}
