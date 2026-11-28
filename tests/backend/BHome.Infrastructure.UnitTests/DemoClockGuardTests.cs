using BHome.Infrastructure.Development;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.UnitTests;

public sealed class DemoClockGuardTests
{
    private static Dictionary<string, string?> Isolated() => new()
    {
        ["DemoClock:Enabled"] = "true",
        ["ConnectionStrings:Database"] = "Host=127.0.0.1;Database=bhome_contract_demo;Username=demo",
        ["ObjectStorage:Endpoint"] = "127.0.0.1:59000",
        ["ObjectStorage:Bucket"] = "contract-demo",
        ["ContractWorkflow:SimulatedSigningEnabled"] = "true"
    };

    [Fact]
    public void UnconfiguredHostsRemainDisabledAndIsolatedDevelopmentCanOptIn()
    {
        Assert.False(DemoClockGuard.Enabled(new ConfigurationBuilder().Build(), "Production"));
        var config = new ConfigurationBuilder().AddInMemoryCollection(Isolated()).Build();
        Assert.True(DemoClockGuard.Enabled(config, "Development"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Staging"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Production"));
    }

    [Theory]
    [InlineData("ConnectionStrings:Database", "Host=127.0.0.1;Database=bhome;Username=demo")]
    [InlineData("ConnectionStrings:Database", "Host=example.org;Database=bhome_contract_demo;Username=demo")]
    [InlineData("ObjectStorage:Endpoint", "example.org:9000")]
    [InlineData("ObjectStorage:Bucket", "bhome-private")]
    [InlineData("ContractWorkflow:SimulatedSigningEnabled", "false")]
    [InlineData("Jobs:Enabled", "true")]
    [InlineData("BillingAutomation:AutomaticJobsEnabled", "true")]
    [InlineData("StaffAssignments:AutoReconcileEnabled", "true")]
    [InlineData("OwnerSetup:AssetSyncEnabled", "true")]
    [InlineData("SePay:Enabled", "true")]
    [InlineData("Email:Enabled", "true")]
    [InlineData("Sms:Enabled", "true")]
    [InlineData("NotificationChannels:AutomationEnabled", "true")]
    public void RefusesUnsafeConfiguration(string key, string value)
    {
        var settings = Isolated();
        settings[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Development"));
    }

    private static Dictionary<string, string?> LocalDevelopment() => new()
    {
        ["DemoClock:Enabled"] = "true",
        ["DemoClock:AllowLocalDevelopment"] = "true",
        ["DemoClock:DevelopmentDatabaseName"] = "bhome_neon_local_20261115",
        ["ConnectionStrings:Database"] = "Host=127.0.0.1;Database=bhome_neon_local_20261115;Username=dev",
        ["ObjectStorage:Endpoint"] = "localhost:9000",
        ["ObjectStorage:Bucket"] = "bhome-private"
    };

    [Fact]
    public void AllowsExplicitLocalSnapshotOnNormalDevelopmentPortal()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(LocalDevelopment()).Build();
        Assert.True(DemoClockGuard.Enabled(config, "Development"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Staging"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Production"));
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void DedicatedBillingDoesNotRequireGeneralJobs(string environment)
    {
        var settings = environment == "Development" ? LocalDevelopment() : environment == "Staging" ? Staging() : Production();
        settings["BillingAutomation:AutomaticJobsEnabled"] = "true";
        Assert.True(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), environment));
    }

    [Theory]
    [InlineData("DemoClock:AllowLocalDevelopment", "false")]
    [InlineData("DemoClock:DevelopmentDatabaseName", "bhome_neon_local_20261116")]
    [InlineData("ConnectionStrings:Database", "Host=neon.example;Database=bhome_neon_local_20261115")]
    [InlineData("ObjectStorage:Endpoint", "storage.example:9000")]
    [InlineData("Deployment:Environment", "Production")]
    [InlineData("Jobs:Enabled", "true")]
    [InlineData("StaffAssignments:AutoReconcileEnabled", "true")]
    [InlineData("DevelopmentDatabase:InitializeOnStartup", "true")]
    [InlineData("OwnerSetup:AssetSyncEnabled", "true")]
    [InlineData("BankIntegration:Enabled", "true")]
    [InlineData("NotificationChannels:AutomationEnabled", "true")]
    [InlineData("SePay:Enabled", "true")]
    public void LocalSnapshotRejectsUnsafeTargetsAndAutomaticJobs(string key, string value)
    {
        var settings = LocalDevelopment();
        settings[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Development"));
    }

    private static Dictionary<string, string?> Staging() => new()
    {
        ["DemoClock:Enabled"] = "true",
        ["DemoClock:OwnerUserId"] = "b0000000-0000-4000-8000-000000000001",
        ["Deployment:Environment"] = "Staging",
        ["ConnectionStrings:Database"] = "Host=postgres;Database=bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989;Username=stage",
        ["ObjectStorage:Endpoint"] = "stage-minio:9000",
        ["ObjectStorage:Bucket"] = "bhome-staging-private",
        ["SePay:Enabled"] = "true",
        ["SePay:Mode"] = "Test"
    };

    [Fact]
    public void StagingConfigurationCannotBeReusedInOtherEnvironments()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(Staging()).Build();
        Assert.True(DemoClockGuard.Enabled(config, "Staging"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Production"));
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Development"));
    }

    [Theory]
    [InlineData("DemoClock:OwnerUserId", "00000000-0000-0000-0000-000000000000")]
    [InlineData("Deployment:Environment", "Production")]
    [InlineData("ConnectionStrings:Database", "Host=postgres;Database=bhome")]
    [InlineData("ConnectionStrings:Database", "Host=other;Database=bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989")]
    [InlineData("ObjectStorage:Bucket", "bhome-private")]
    [InlineData("ObjectStorage:Endpoint", "minio:9000")]
    [InlineData("DevelopmentDatabase:InitializeOnStartup", "true")]
    [InlineData("StaffAssignments:AutoReconcileEnabled", "true")]
    [InlineData("OwnerSetup:AssetSyncEnabled", "true")]
    public void RefusesUnsafeStagingConfiguration(string key, string value)
    {
        var settings = Staging();
        settings[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(config, "Staging"));
    }

    private static Dictionary<string, string?> Production() => new()
    {
        ["Deployment:Environment"] = "Production",
        ["ConnectionStrings:Database"] = "Host=postgres;Database=bhome;Username=demo",
        ["ObjectStorage:Endpoint"] = "minio:9000",
        ["ObjectStorage:Bucket"] = "bhome-private",
        ["SePay:Enabled"] = "false",
        ["SePay:Mode"] = "Live"
    };

    [Theory]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void AcademicDeploymentsDiscoverClockByDefaultAndCanExplicitlyDisable(string environment)
    {
        var settings = environment == "Staging" ? Staging() : Production();
        settings.Remove("DemoClock:Enabled");
        settings.Remove("DemoClock:OwnerUserId");
        Assert.True(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), environment));
        settings["DemoClock:Enabled"] = "true";
        settings["DemoClock:OwnerUserId"] = "";
        Assert.True(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), environment));
        settings["DemoClock:Enabled"] = "false";
        Assert.False(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), environment));
    }

    [Theory]
    [InlineData("Deployment:Environment", "Staging")]
    [InlineData("ConnectionStrings:Database", "Host=postgres;Database=bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989")]
    [InlineData("ConnectionStrings:Database", "Host=remote;Database=bhome")]
    [InlineData("ObjectStorage:Endpoint", "stage-minio:9000")]
    [InlineData("ObjectStorage:Bucket", "bhome-staging-private")]
    [InlineData("StaffAssignments:AutoReconcileEnabled", "true")]
    [InlineData("OwnerSetup:AssetSyncEnabled", "true")]
    [InlineData("DevelopmentDatabase:InitializeOnStartup", "true")]
    [InlineData("BankIntegration:Enabled", "true")]
    [InlineData("DemoClock:OwnerUserId", "invalid")]
    public void UnsafeProductionDefaultsToNoClockAndRejectsExplicitEnablement(string key, string value)
    {
        var settings = Production();
        settings[key] = value;
        Assert.False(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), "Production"));
        settings["DemoClock:Enabled"] = "true";
        Assert.Throws<InvalidOperationException>(() => DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), "Production"));
    }

    [Theory]
    [InlineData("Staging", "SePay:Mode", "Live")]
    [InlineData("Staging", "SePay:Enabled", "false")]
    [InlineData("Staging", "Jobs:Enabled", "true")]
    [InlineData("Staging", "ContractWorkflow:SimulatedSigningEnabled", "true")]
    [InlineData("Production", "SePay:Mode", "Test")]
    [InlineData("Production", "SePay:Enabled", "true")]
    [InlineData("Production", "Jobs:Enabled", "true")]
    [InlineData("Production", "ContractWorkflow:SimulatedSigningEnabled", "true")]
    public void AcademicDeploymentAllowsPreviouslyRestrictedDemoOptions(string environment, string key, string value)
    {
        var settings = environment == "Staging" ? Staging() : Production();
        settings[key] = value;
        Assert.True(DemoClockGuard.Enabled(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(), environment));
    }

    [Theory]
    [InlineData("Staging", "Test", false)]
    [InlineData("Staging", "Live", true)]
    [InlineData("Production", "Test", true)]
    [InlineData("Production", "Live", false)]
    public void AcademicClockSupportsPaymentsSigningAndWorkersWithoutShiftingSecurityTime(string environment, string mode, bool simulated)
    {
        var settings = environment == "Staging" ? Staging() : Production();
        settings["DemoClock:Enabled"] = "true";
        settings["SePay:Enabled"] = "true";
        settings["SePay:Mode"] = mode;
        settings["Jobs:Enabled"] = "true";
        settings["BillingAutomation:AutomaticJobsEnabled"] = "true";
        settings["ContractWorkflow:SimulatedSigningEnabled"] = simulated.ToString();
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        Assert.True(DemoClockGuard.Enabled(config, environment));
        var before = DateTimeOffset.UtcNow;
        var clock = new BHome.Application.Common.DemoBusinessClock(TimeProvider.System);
        clock.Change(new DateOnly(2030, 6, 1), 0);
        Assert.InRange(clock.GetUtcNow(), before, DateTimeOffset.UtcNow);
        Assert.Equal(new DateOnly(2030, 6, 1), clock.Read().BusinessDate);
    }
}
