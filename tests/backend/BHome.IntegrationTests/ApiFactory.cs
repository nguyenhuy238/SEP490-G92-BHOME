using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using BHome.IntegrationTests.Fixtures;

namespace BHome.IntegrationTests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string ConnectionString { get; set; } = "Host=127.0.0.1;Database=bhome_tests;Username=unconfigured;Timeout=1";
    public bool UseCompact24 { get; init; }
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = ConnectionString,
            ["Jwt:SigningKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),
            ["Api:UseHttpsRedirection"] = "false",
            ["Api:ReadDevelopmentEnvironmentFile"] = "false",
            ["Jobs:Enabled"] = "false",
            // Each database fixture owns its schema; Development-only HTTP tests also
            // opt out. The startup provisioning test explicitly enables this setting.
            ["DevelopmentDatabase:InitializeOnStartup"] = "false",
            ["AuthRateLimit:PermitLimit"] = "10000"
        }));
        builder.ConfigureServices(services =>
        {
            services.AddControllers().AddApplicationPart(typeof(TestProbeController).Assembly);
            if (!UseCompact24) services.UseLegacyPersistenceForTesting();
        });
    }
}
