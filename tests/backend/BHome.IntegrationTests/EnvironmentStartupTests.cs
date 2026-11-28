using System.Net;
using BHome.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests;

public sealed class EnvironmentStartupTests
{
    private static readonly Dictionary<string, string?> Stage = new()
    {
        ["Deployment:Environment"] = "Staging",
        ["Deployment:OwnerOrigin"] = "https://stage.example.invalid",
        ["Deployment:ApiOrigin"] = "https://api-stage.example.invalid",
        ["AllowedHosts"] = "stage.example.invalid;api-stage.example.invalid;localhost",
        ["Email:Enabled"] = "false",
        ["SePay:Enabled"] = "false",
        ["SePay:Mode"] = "Test"
    };

    [Fact]
    public async Task StagingStartsWithoutLocalEnvironmentFileAndDerivesMatchingCallbacks()
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Staging");
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(Stage));
        });
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        var config = (IConfiguration)host.Services.GetService(typeof(IConfiguration))!;
        Assert.Equal("https://stage.example.invalid/reset-password", config["AuthenticationEmail:WebResetUrl"]);
        Assert.Equal("https://stage.example.invalid/contract-signing", config["AnonymousSigning:PublicSigningUrl"]);
        Assert.Equal("https://api-stage.example.invalid/open/sign-contract", config["ContractSigning:InvitationLink:PublicOpenUrl"]);
        Assert.True(config.GetValue<bool>("NotificationChannels:ContractAndInvoiceEmailEnabled"));
        Assert.False(config.GetValue<bool>("NotificationChannels:AutomationEnabled"));
        Assert.False(config.GetValue<bool>("Jobs:Enabled"));
    }

    [Theory]
    [InlineData("AnonymousSigning:PublicSigningUrl", "https://owner.production.example/contract-signing")]
    [InlineData("AuthenticationEmail:WebInvitationUrl", "http://localhost:5173/accept-invitation")]
    [InlineData("Deployment:Environment", "Production")]
    public void InvalidEnvironmentFailsBeforeAnyDatabaseConnection(string key, string value)
    {
        using var factory = new ApiFactory();
        var settings = new Dictionary<string, string?>(Stage) { [key] = value };
        using var host = factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Staging");
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(settings));
        });
        Assert.Throws<OptionsValidationException>(() => host.CreateClient());
    }
}
