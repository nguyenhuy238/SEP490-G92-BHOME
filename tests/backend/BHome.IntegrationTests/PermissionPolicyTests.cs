using System.Reflection;
using System.Security.Claims;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

public sealed class PermissionPolicyTests
{
    [Fact]
    public async Task EveryPermissionPolicyRequiresAuthenticationAndUsesTheSameFixedGrants()
    {
        using var factory = new ApiFactory();
        var provider = factory.Services.GetRequiredService<IAuthorizationPolicyProvider>();
        foreach (var entry in RolePermissions.All)
        {
            var policy = await provider.GetPolicyAsync(entry.Key);
            Assert.NotNull(policy);
            Assert.Contains(policy.Requirements, requirement => requirement is DenyAnonymousAuthorizationRequirement);
            var roles = Assert.Single(policy.Requirements.OfType<RolesAuthorizationRequirement>());
            Assert.Equal(entry.Value.Order(), roles.AllowedRoles.Order());
        }
        Assert.Null(await provider.GetPolicyAsync("unregistered.permission"));
    }

    [Fact]
    public async Task ShippedControllersOnlyReferenceRegisteredPolicies()
    {
        using var factory = new ApiFactory();
        var provider = factory.Services.GetRequiredService<IAuthorizationPolicyProvider>();
        var controllers = typeof(Program).Assembly.GetTypes().Where(type => type.IsSubclassOf(typeof(ControllerBase)));
        var policies = controllers.SelectMany(type => type.GetCustomAttributes<AuthorizeAttribute>()
            .Concat(type.GetMethods().SelectMany(method => method.GetCustomAttributes<AuthorizeAttribute>())))
            .Select(attribute => attribute.Policy).Where(policy => policy is not null).Distinct();
        foreach (var policy in policies) Assert.NotNull(await provider.GetPolicyAsync(policy!));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CurrentUserIgnoresClaimsOnAnUnauthenticatedPrincipal(bool authenticated)
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var accessor = scope.ServiceProvider.GetRequiredService<IHttpContextAccessor>();
        var id = Guid.NewGuid();
        accessor.HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", id.ToString()), new Claim("role", Roles.Owner)],
                authenticated ? "synthetic-test" : null, "sub", "role"))
        };
        try
        {
            var user = scope.ServiceProvider.GetRequiredService<ICurrentUser>();
            Assert.Equal(authenticated ? id : (Guid?)null, user.UserId);
            Assert.Equal(authenticated, user.IsInRole(Roles.Owner));
        }
        finally { accessor.HttpContext = null; }
    }
}
