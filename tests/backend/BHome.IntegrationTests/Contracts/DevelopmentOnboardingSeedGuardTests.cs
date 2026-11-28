using BHome.IntegrationTests.Fixtures;
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
    public void DevelopmentEnvironmentFileIgnoresRetiredSeedSettingsAndUnrelatedKeys()
    {
        var file = Path.Combine(Path.GetTempPath(), "bhome-seed-config-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(file, "DevelopmentContractSeed__Enabled=true\n" +
                "DevelopmentContractSeed__TenantPassword=synthetic-dev-password\n" +
                "UNRELATED__Value=ignored");
            var configuration = new ConfigurationManager();
            DevelopmentEnvironmentFile.AddFile(configuration, file);

            Assert.Null(configuration["DevelopmentContractSeed:Enabled"]);
            Assert.Null(configuration["DevelopmentContractSeed:TenantPassword"]);
            Assert.Null(configuration["UNRELATED:Value"]);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void OnlyExplicitlyEnabledDevelopmentOnLoopbackDatabaseCanCreateSyntheticContracts()
    {
        Assert.True(DevelopmentOnboardingSeedFixtureController.Allowed("Development", true, Local));
        Assert.True(DevelopmentOnboardingSeedFixtureController.Allowed("Development", true,
            "Host=localhost;Database=bhome_neon_local_20261115;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Production", true, Local));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Testing", true, Local));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Development", false, Local));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Development", true,
            "Host=ep-demo.neon.tech;Database=bhome_compact24_dev_synthetic;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Development", true,
            "Host=127.0.0.1;Database=other_database;Username=test;Password=not-a-secret"));
        Assert.False(DevelopmentOnboardingSeedFixtureController.Allowed("Development", true, "not a connection string"));
    }

    [Fact]
    public void DevelopmentSeedIsOwnerOnlyAndDoesNotExposeDatabaseToController()
    {
        var authorization = Assert.Single(typeof(DevelopmentOnboardingSeedFixtureController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>());
        Assert.Equal(Roles.Owner, authorization.Roles);
        Assert.DoesNotContain(typeof(DevelopmentOnboardingSeedFixtureController).GetConstructors()
            .SelectMany(c => c.GetParameters()), p => typeof(DbContext).IsAssignableFrom(p.ParameterType));
    }
}
