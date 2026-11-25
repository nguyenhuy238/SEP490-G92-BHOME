using BHome.Api.Controllers;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace BHome.IntegrationTests.Compact24;

public sealed class DemoClockControllerTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly DateOnly Target = new(2026, 11, 1);

    [Theory]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void OnlyDesignatedDeployedOwnerMayChangeSharedClock(string environment)
    {
        var clock = new DemoBusinessClock(TimeProvider.System);
        var owner = Controller(clock, environment, Owner, Roles.Owner);
        var other = Controller(clock, environment, Guid.NewGuid(), Roles.Owner);
        var staff = Controller(clock, environment, Guid.NewGuid(), Roles.Staff);
        var tenant = Controller(clock, environment, Guid.NewGuid(), Roles.Tenant);

        Assert.True(Read(owner).CanChange);
        Assert.False(Read(other).CanChange);
        Assert.False(Read(staff).CanChange);
        Assert.False(Read(tenant).CanChange);
        Assert.IsType<ForbidResult>(other.Change(new(Target, 0)).Result);
        Assert.IsType<ForbidResult>(staff.Change(new(Target, 0)).Result);
        Assert.IsType<ForbidResult>(tenant.Change(new(Target, 0)).Result);
        Assert.IsType<BadRequestResult>(owner.Change(new(Target, null)).Result);
        Assert.IsType<OkObjectResult>(owner.Change(new(Target, 0)).Result);
        Assert.Equal(Target, Read(staff).BusinessDate);
        Assert.Equal(Target, Read(tenant).BusinessDate);
        Assert.IsType<ConflictResult>(owner.Change(new(null, 0)).Result);
        Assert.IsType<OkObjectResult>(owner.Change(new(null, 1)).Result);
        Assert.False(Read(tenant).Simulated);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void AllAuthenticatedOwnersCanChangeWhenNoOwnerRestrictionIsConfigured(string environment)
    {
        var clock = new DemoBusinessClock(TimeProvider.System);
        var owner = Controller(clock, environment, Guid.NewGuid(), Roles.Owner, restricted: false);
        var staff = Controller(clock, environment, Guid.NewGuid(), Roles.Staff, restricted: false);
        var tenant = Controller(clock, environment, Guid.NewGuid(), Roles.Tenant, restricted: false);
        Assert.True(Read(owner).CanChange);
        Assert.False(Read(staff).CanChange);
        Assert.False(Read(tenant).CanChange);
        Assert.IsType<OkObjectResult>(owner.Change(new(Target, 0)).Result);
        Assert.Equal(Target, Read(tenant).BusinessDate);
        Assert.IsType<ForbidResult>(staff.Change(new(null, 1)).Result);
        Assert.IsType<OkObjectResult>(owner.Change(new(null, 1)).Result);
        Assert.False(Read(staff).Simulated);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void DisabledEndpointsRemainUnavailable(string environment)
    {
        var disabled = Controller(TimeProvider.System, environment, Owner, Roles.Owner);
        Assert.IsType<NotFoundResult>(disabled.Read().Result);
        Assert.IsType<NotFoundResult>(disabled.Change(new(Target, 0)).Result);
    }

    [Fact]
    public void ExactTimeIsVersionedAndOwnerOnly()
    {
        var clock = new DemoBusinessClock(TimeProvider.System);
        var owner = Controller(clock, "Staging", Owner, Roles.Owner);
        var staff = Controller(clock, "Staging", Guid.NewGuid(), Roles.Staff);
        var target = new DateTimeOffset(2026, 12, 24, 23, 59, 58, TimeSpan.FromHours(7));
        Assert.IsType<ForbidResult>(staff.Change(new(null, 0, target)).Result);
        Assert.IsType<BadRequestResult>(owner.Change(new(null, 0, target.ToUniversalTime())).Result);
        Assert.IsType<OkObjectResult>(owner.Change(new(null, 0, target)).Result);
        Assert.True(Read(owner).Simulated);
        Assert.IsType<ConflictResult>(owner.Change(new(null, 0)).Result);
        Assert.IsType<OkObjectResult>(owner.Change(new(null, 1)).Result);
        Assert.False(Read(owner).Simulated);
    }

    private static DemoClockState Read(DemoClockController controller) =>
        Assert.IsType<DemoClockState>(Assert.IsType<OkObjectResult>(controller.Read().Result).Value);

    private static DemoClockController Controller(TimeProvider clock, string environment, Guid id, string role, bool restricted = true) =>
        new(clock, new Host { EnvironmentName = environment },
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["DemoClock:OwnerUserId"] = restricted ? Owner.ToString() : null }).Build(), new Actor(id, role));

    private sealed class Actor(Guid id, string role) : ICurrentUser
    {
        public Guid? UserId => id;
        public bool IsInRole(string value) => value == role;
    }

    private sealed class Host : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Staging";
        public string ApplicationName { get; set; } = "BHome.Api";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
