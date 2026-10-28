using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string ConnectionString { get; set; } = "Host=127.0.0.1;Database=bhome_tests;Username=unconfigured;Timeout=1";
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = ConnectionString,
            ["Jwt:SigningKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),
            ["Api:UseHttpsRedirection"] = "false",
            ["Jobs:Enabled"] = "false"
        }));
        builder.ConfigureServices(services => services.AddControllers().AddApplicationPart(typeof(TestProbeController).Assembly));
    }
}
