using BHome.Infrastructure.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.UnitTests;

public sealed class ContractWorkflowDemoDeploymentTests
{
    [Theory]
    [InlineData("Production", true, true)]
    [InlineData("Production", false, false)]
    [InlineData("Staging", true, true)]
    [InlineData("Staging", false, false)]
    [InlineData("Development", false, true)]
    [InlineData("Testing", false, true)]
    [InlineData("Custom", true, false)]
    public void SimulatedSigningRequiresExplicitAcademicDeploymentOrLocalHost(string environment, bool demo, bool allowed)
    {
        var staging = environment == "Staging";
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            DisableDefaults = true, EnvironmentName = environment, ContentRootPath = AppContext.BaseDirectory
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DemoClock:Enabled"] = demo.ToString(),
            ["Deployment:Environment"] = environment,
            ["ConnectionStrings:Database"] = $"Host=postgres;Database={(staging ? "bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989" : "bhome")};Username=synthetic",
            ["ObjectStorage:Endpoint"] = staging ? "stage-minio:9000" : "minio:9000",
            ["ObjectStorage:Bucket"] = staging ? "bhome-staging-private" : "bhome-private"
        });
        var validator = new ContractWorkflowOptionsValidator(builder.Environment, builder.Configuration);
        Assert.Equal(allowed, validator.Validate(null, new() { SimulatedSigningEnabled = true }).Succeeded);
        Assert.True(validator.Validate(null, new() { SimulatedSigningEnabled = false }).Succeeded);
    }
}
