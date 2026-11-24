using BHome.Api.Controllers;
using BHome.Api.Configuration;
using BHome.Infrastructure.Development;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests.Contracts;

public sealed class DevelopmentOnboardingSeedGuardTests
{
    private const string Local = "Host=127.0.0.1;Database=bhome_compact24_dev_synthetic;Username=test;Password=not-a-secret";

    [Fact]
    public void DevelopmentEnvironmentFileLoadsSeedSettingsWithoutAcceptingUnrelatedKeys()
    {
        var file = Path.Combine(Path.GetTempPath(), "bhome-seed-config-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(file, "DevelopmentContractSeed__Enabled=true\n" +
                "DevelopmentContractSeed__TenantPassword=synthetic-dev-password\n" +
                "UNRELATED__Value=ignored");
            var configuration = new ConfigurationManager();
            DevelopmentEnvironmentFile.AddFile(configuration, file);

            Assert.True(configuration.GetValue<bool>("DevelopmentContractSeed:Enabled"));
            Assert.Equal("synthetic-dev-password", configuration["DevelopmentContractSeed:TenantPassword"]);
            Assert.Null(configuration["UNRELATED:Value"]);
        }
        finally { File.Delete(file); }
    }

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
    public void DevelopmentSeedIsOwnerOnlyAndDoesNotExposeDatabaseToController()
    {
        var authorization = Assert.Single(typeof(DevelopmentOnboardingSeedController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>());
        Assert.Equal(Roles.Owner, authorization.Roles);
        Assert.DoesNotContain(typeof(DevelopmentOnboardingSeedController).GetConstructors()
            .SelectMany(c => c.GetParameters()), p => typeof(DbContext).IsAssignableFrom(p.ParameterType));
    }
}
