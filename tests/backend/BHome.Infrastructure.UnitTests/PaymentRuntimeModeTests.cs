using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.UnitTests;

public sealed class PaymentRuntimeModeTests
{
    [Theory]
    [InlineData("Development", false, "Test", true, true)]
    [InlineData("Testing", false, "Test", true, true)]
    [InlineData("Staging", true, "Test", false, true)]
    [InlineData("Staging", false, "Test", false, true)]
    [InlineData("Staging", true, "Live", false, true)]
    [InlineData("Production", true, "Test", false, true)]
    [InlineData("Production", true, "Live", false, true)]
    [InlineData("Production", false, "Test", false, true)]
    public void ReceivingChannelsAreAvailableOnEveryHostWithoutEnablingManualDemoPayments(
        string environment, bool enabled, string providerMode, bool allowDevelopmentDemo, bool allowSandboxAccounts)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            DisableDefaults = true,
            EnvironmentName = environment,
            ContentRootPath = AppContext.BaseDirectory
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = "Host=localhost;Database=synthetic;Username=synthetic;Password=synthetic"
        });
        builder.Services.AddInfrastructure(builder.Configuration);
        // Inject inert settings to exercise the DI policy without starting providers or contacting a bank/database.
        // Existing SePay option-validation tests separately reject invalid environment/provider combinations.
        builder.Services.AddSingleton(new SePayOptions { Enabled = enabled, Mode = providerMode });
        using var host = builder.Build();
        var mode = host.Services.GetRequiredService<PaymentRuntimeMode>();
        Assert.Equal(allowDevelopmentDemo, mode.AllowDevelopmentDemo);
        Assert.Equal(allowSandboxAccounts, mode.AllowSandboxReceivingAccounts);
    }
}
