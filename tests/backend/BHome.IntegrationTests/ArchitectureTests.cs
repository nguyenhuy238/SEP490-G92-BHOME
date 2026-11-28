using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace BHome.IntegrationTests;

public sealed class ArchitectureTests
{
    [Fact]
    public void InnerLayersDoNotReferenceOuterLayersOrPersistenceFrameworks()
    {
        var assembly = typeof(Program).Assembly;
        Assert.Same(assembly, typeof(Roles).Assembly);
        Assert.Same(assembly, typeof(ResourceAccess).Assembly);
        Assert.DoesNotContain(assembly.GetReferencedAssemblies(), reference => reference.Name is "BHome.Domain" or "BHome.Application" or "BHome.Infrastructure");

        // These layers now share an assembly; enforce their original dependency direction
        // at the namespace/source level rather than expecting separate assembly references.
        DirectoryInfo? root = new(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "src", "backend", "BHome.Api", "BHome.Api.csproj")))
            root = root.Parent;
        Assert.NotNull(root);
        var api = Path.Combine(root!.FullName, "src", "backend", "BHome.Api");
        var sources = Directory.EnumerateFiles(api, "*.cs", SearchOption.AllDirectories)
            .Where(path => !Path.GetRelativePath(api, path).Split(Path.DirectorySeparatorChar).Any(part => part is "bin" or "obj" || part.StartsWith(".artifacts", StringComparison.Ordinal)))
            .Select(path => (Path: path, Text: File.ReadAllText(path))).ToArray();
        var domain = sources.Where(source => Regex.IsMatch(source.Text, @"\bnamespace\s+BHome\.Domain\b")).ToArray();
        var application = sources.Where(source => Regex.IsMatch(source.Text, @"\bnamespace\s+BHome\.Application\b")).ToArray();
        Assert.NotEmpty(domain);
        Assert.NotEmpty(application);
        // Global imports would bypass the per-file namespace guard, so disallow
        // introducing outer-layer or persistence imports into every source file.
        foreach (var source in sources)
            Assert.False(Regex.IsMatch(source.Text, @"\bglobal\s+using\s+[^;]*(?:\bBHome\s*\.\s*(?!Domain\b)\w+|\bEntityFramework\w*\b)"), $"Global layer dependency in {source.Path}");
        foreach (var source in domain)
            Assert.False(Regex.IsMatch(source.Text, @"\bBHome\s*\.\s*(?!Domain\b)\w+|\bEntityFramework\w*\b"), $"Domain dependency in {source.Path}");
        foreach (var source in application)
            Assert.False(Regex.IsMatch(source.Text, @"\bBHome\s*\.\s*(?:Infrastructure|Api)\b|\bEntityFramework\w*\b"), $"Application dependency in {source.Path}");
    }

    [Fact]
    public void ApiControllersDoNotInjectDbContext()
    {
        var parameters = typeof(Program).Assembly.GetTypes().Where(t => t.IsSubclassOf(typeof(ControllerBase)))
            .SelectMany(t => t.GetConstructors()).SelectMany(c => c.GetParameters());
        Assert.DoesNotContain(parameters, parameter => typeof(DbContext).IsAssignableFrom(parameter.ParameterType));
        Assert.Equal("BHome.LegacyPersistence", typeof(BHomeDbContext).Assembly.GetName().Name);
        Assert.DoesNotContain(typeof(Program).Assembly.GetReferencedAssemblies(), reference => reference.Name == "BHome.LegacyPersistence");
    }

    [Fact]
    public void ControllersAreGroupedAndOfflineAdaptersStayOutOfApi()
    {
        DirectoryInfo? root = new(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "src", "backend", "BHome.Api", "BHome.Api.csproj")))
            root = root.Parent;
        Assert.NotNull(root);
        var controllers = Path.Combine(root!.FullName, "src", "backend", "BHome.Api", "Controllers");
        Assert.Empty(Directory.EnumerateFiles(controllers, "*.cs", SearchOption.TopDirectoryOnly));

        var assembly = typeof(Program).Assembly;
        Assert.DoesNotContain(assembly.GetTypes(), type => type.Name is
            "NotificationRepository" or "NotificationDeliveryStore" or "UnconfiguredPasswordResetDelivery" or
            "UnconfiguredContractHoldingLedger" or "MeterWindowCrop");
    }
}
