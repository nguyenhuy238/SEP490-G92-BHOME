using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.UnitTests;

public sealed class PropertyServiceDependencyGraphTests
{
    [Fact]
    public void OwnerLocationAndInventoryServicesResolveWithoutCircularDependencies()
    {
        // No database is contacted: exercise the production DI graph with inert test settings.
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            DisableDefaults = true,
            EnvironmentName = "Testing",
            ContentRootPath = AppContext.BaseDirectory
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = "Host=localhost;Database=synthetic;Username=synthetic;Password=synthetic",
            ["DevelopmentDatabase:AllowPreviousPropertySchema"] = "true"
        });
        builder.Services.AddInfrastructure(builder.Configuration);
        builder.Services.AddScoped<ICurrentUser>(_ => new SyntheticOwner());

        using var host = builder.Build();
        using var scope = host.Services.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService<PropertyService>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<ContractService>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<IContractHandoverRepository>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<RoomInventoryReviewService>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<CommonAssetInventoryReviewService>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<IHandoverInventory>());
    }

    private sealed class SyntheticOwner : ICurrentUser
    {
        public Guid? UserId => Guid.Parse("00000000-0000-4000-8000-000000000001");
        public bool IsInRole(string role) => role == "Owner";
    }
}
