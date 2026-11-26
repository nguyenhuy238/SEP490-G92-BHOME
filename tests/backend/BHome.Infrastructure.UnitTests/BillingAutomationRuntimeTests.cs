using BHome.Application.Billing;
using BHome.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.UnitTests;

public sealed class BillingAutomationRuntimeTests
{
    [Theory]
    [InlineData("Development", false, false, false, true, false)]
    [InlineData("Testing", false, false, false, true, false)]
    [InlineData("Staging", false, false, false, false, false)]
    [InlineData("Staging", true, false, false, true, false)]
    [InlineData("Staging", true, true, false, true, false)]
    [InlineData("Staging", true, false, true, true, true)]
    [InlineData("Production", false, false, true, false, true)]
    [InlineData("Development", false, false, true, true, true)]
    [InlineData("Staging", false, true, true, false, true)]
    [InlineData("Production", true, false, false, false, false)]
    [InlineData("Custom", true, false, false, false, false)]
    public void ManualStagingOptInIsIndependentOfWorkersAndOtherDeveloperActions(
        string environment, bool manual, bool jobs, bool automatic, bool canRun, bool worker)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            DisableDefaults = true,
            EnvironmentName = environment,
            ContentRootPath = AppContext.BaseDirectory
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = "Host=localhost;Database=synthetic;Username=synthetic;Password=synthetic",
            ["BillingAutomation:ManualActionsEnabled"] = manual.ToString(),
            ["Jobs:Enabled"] = jobs.ToString(),
            ["BillingAutomation:AutomaticJobsEnabled"] = automatic.ToString()
        });
        builder.Services.AddInfrastructure(builder.Configuration);
        using var host = builder.Build();
        var runtime = host.Services.GetRequiredService<BillingAutomationRuntime>();
        Assert.Equal(canRun, runtime.CanRunManualActions);
        Assert.Equal(worker, runtime.WorkerEnabled);
        Assert.Equal(environment is "Development" or "Testing", runtime.DeveloperActionsEnabled);
    }
}
