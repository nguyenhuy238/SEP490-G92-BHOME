using BHome.Api.Controllers;
using BHome.Infrastructure.Development;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Contracts;

public sealed class DevelopmentOnboardingSeedGuardTests
{
    private const string Local = "Host=127.0.0.1;Database=bhome_compact24_dev_synthetic;Username=test;Password=not-a-secret";

    [Fact]
    public void OnlyExplicitlyEnabledDevelopmentOnLoopbackDatabaseCanCreateSyntheticContracts()
    {
        Assert.True(DevelopmentOnboardingSeedController.Allowed("Development", true, Local));
        Assert.True(DevelopmentOnboardingSeedController.Allowed("Development", true,
            "Host=localhost;Database=bhome_neon_local_20261115;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Production", true, Local));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Testing", true, Local));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Development", false, Local));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Development", true,
            "Host=ep-demo.neon.tech;Database=bhome_compact24_dev_synthetic;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Development", true,
            "Host=127.0.0.1;Database=other_database;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedController.Allowed("Development", true, "not a connection string"));
    }

    [Fact]
    public void DevelopmentSeedDefinesRealRoomInventoryWithoutFakeImagesOrControllerDatabaseDependency()
    {
        var configured = DevelopmentOnboardingSeedService.SampleInventory;
        Assert.True(configured.Length >= 3);
        Assert.All(configured, asset =>
        {
            Assert.False(string.IsNullOrWhiteSpace(asset.Name));
            Assert.False(string.IsNullOrWhiteSpace(asset.Category));
            Assert.True(asset.Quantity > 0);
            Assert.Contains(asset.TrackingMode, new[] { "BulkQuantity", "Serialized" });
            Assert.True(asset.TrackingMode != "Serialized" || asset.Quantity == 1);
        });
        Assert.Equal(configured.Length, configured.Select(asset => asset.Name).Distinct().Count());
        Assert.Contains(configured, asset => asset.Quantity > 1);
        Assert.DoesNotContain(typeof(DevelopmentOnboardingSeedController).GetConstructors()
            .SelectMany(c => c.GetParameters()), p => typeof(DbContext).IsAssignableFrom(p.ParameterType));
    }
}
