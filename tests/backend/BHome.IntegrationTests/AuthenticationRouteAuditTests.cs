using Microsoft.AspNetCore.Mvc.ActionConstraints;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace BHome.IntegrationTests;

public sealed class AuthenticationRouteAuditTests(ITestOutputHelper output)
{
    [Fact]
    public void ExistingAuthenticationRoutesAreDiscoveredFromControllerActionDescriptors()
    {
        using var host = new ApiFactory();
        var routes = host.Services.GetRequiredService<IActionDescriptorCollectionProvider>().ActionDescriptors.Items
            .OfType<ControllerActionDescriptor>()
            .Where(a => a.AttributeRouteInfo?.Template is { } route &&
                (route.StartsWith("api/v1/auth/") || route == "api/v1/account/profile" || route.EndsWith("/invitation")))
            .SelectMany(a => a.ActionConstraints!.OfType<HttpMethodActionConstraint>()
                .SelectMany(c => c.HttpMethods.Select(method => method + " /" + a.AttributeRouteInfo!.Template)))
            .Order().ToArray();
        foreach (var route in routes) output.WriteLine(route);
        foreach (var route in new[]
        {
            "POST /api/v1/auth/login", "POST /api/v1/auth/refresh", "POST /api/v1/auth/logout", "POST /api/v1/auth/logout-all",
            "GET /api/v1/auth/me", "POST /api/v1/auth/change-password", "POST /api/v1/auth/forgot-password",
            "POST /api/v1/auth/reset-password", "POST /api/v1/auth/request-email-verification", "POST /api/v1/auth/confirm-email",
            "POST /api/v1/auth/accept-invitation", "GET /api/v1/account/profile", "PUT /api/v1/account/profile"
        }) Assert.Contains(route, routes);
        Assert.Equal(routes.Length, routes.Distinct().Count());
    }
}
