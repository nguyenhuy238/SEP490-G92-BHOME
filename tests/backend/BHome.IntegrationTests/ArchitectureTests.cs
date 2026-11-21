using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests;

public sealed class ArchitectureTests
{
    [Fact]
    public void InnerLayersDoNotReferenceOuterLayersOrPersistenceFrameworks()
    {
        var domainReferences = typeof(Roles).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
        Assert.DoesNotContain(domainReferences, name => name?.StartsWith("BHome.") == true || name?.Contains("EntityFramework") == true);
        var applicationReferences = typeof(ResourceAccess).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
        Assert.DoesNotContain("BHome.Infrastructure", applicationReferences);
        Assert.DoesNotContain("BHome.Api", applicationReferences);
        Assert.DoesNotContain(applicationReferences, name => name?.Contains("EntityFramework") == true);
    }

    [Fact]
    public void ApiControllersDoNotInjectDbContext()
    {
        var parameters = typeof(Program).Assembly.GetTypes().Where(t => t.IsSubclassOf(typeof(ControllerBase)))
            .SelectMany(t => t.GetConstructors()).SelectMany(c => c.GetParameters());
        Assert.DoesNotContain(parameters, parameter => typeof(DbContext).IsAssignableFrom(parameter.ParameterType));
        Assert.NotEqual(typeof(Program).Assembly, typeof(BHomeDbContext).Assembly);
    }
}
