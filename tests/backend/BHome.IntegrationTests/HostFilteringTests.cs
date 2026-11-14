using System.Net;
using BHome.Api.Configuration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests;

public sealed class HostFilteringTests
{
    [Theory]
    [InlineData("localhost", HttpStatusCode.OK)]
    [InlineData("127.0.0.1", HttpStatusCode.OK)]
    [InlineData("unconfigured.ngrok-free.dev", HttpStatusCode.BadRequest)]
    public async Task DefaultAllowlistRejectsUnconfiguredTunnel(string host, HttpStatusCode expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Host = host;
        using var response = await client.SendAsync(request);
        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData("localhost", HttpStatusCode.OK)]
    [InlineData("127.0.0.1:7240", HttpStatusCode.OK)]
    [InlineData("192.0.2.10", HttpStatusCode.OK)]
    [InlineData("desktop.example.invalid", HttpStatusCode.OK)]
    [InlineData("configured.ngrok-free.dev", HttpStatusCode.OK)]
    [InlineData("unexpected.example.invalid", HttpStatusCode.BadRequest)]
    [InlineData("other.ngrok-free.dev", HttpStatusCode.BadRequest)]
    [InlineData("configured.ngrok-free.dev.evil.invalid", HttpStatusCode.BadRequest)]
    public async Task EnvironmentFileAllowsOnlyExplicitHosts(string host, HttpStatusCode expected)
    {
        var file = Path.Combine(Path.GetTempPath(), "bhome-hosts-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(file, "AllowedHosts=localhost;127.0.0.1;192.0.2.10;desktop.example.invalid;configured.ngrok-free.dev");
            var configuration = new ConfigurationManager();
            DevelopmentEnvironmentFile.AddFile(configuration, file);
            using var factory = new ApiFactory();
            using var configured = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
                config.AddConfiguration(configuration)));
            using var client = configured.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
            request.Headers.Host = host;
            // A forwarded localhost must not allow an invalid Host through the allowlist.
            request.Headers.Add("X-Forwarded-Host", "localhost");
            request.Headers.Add("X-Forwarded-Proto", "http");
            using var response = await client.SendAsync(request);
            Assert.Equal(expected, response.StatusCode);
            Assert.Null(response.Headers.Location);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void EnvironmentFilePreservesHigherPriorityHostConfiguration()
    {
        var file = Path.Combine(Path.GetTempPath(), "bhome-hosts-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(file, "AllowedHosts=localhost;configured.ngrok-free.dev");
            var configuration = new ConfigurationManager();
            configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["AllowedHosts"] = "localhost;explicit.example.invalid" });
            DevelopmentEnvironmentFile.AddFile(configuration, file);
            Assert.Equal("localhost;explicit.example.invalid", configuration["AllowedHosts"]);
        }
        finally { File.Delete(file); }
    }
}
