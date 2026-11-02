using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests;

public sealed class MobileWebCorsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory factory;
    public MobileWebCorsTests(ApiFactory factory) => this.factory = factory;

    [Theory]
    [InlineData("http://localhost:8081", true)]
    [InlineData("http://127.0.0.1:8081", true)]
    [InlineData("http://localhost:5173", true)]
    [InlineData("http://localhost:8082", false)]
    [InlineData("http://untrusted.example.invalid:8081", false)]
    [InlineData("http://localhost:8081.untrusted.example.invalid", false)]
    public async Task DevelopmentPreflightAllowsOnlyConfiguredOrigins(string origin, bool allowed)
    {
        // Load the actual checked-in Development origins without loading user secrets
        // or starting development jobs/integrations in the test host.
        using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((context, config) => config.AddJsonFile(
                Path.Combine(context.HostingEnvironment.ContentRootPath, "appsettings.Development.json"))));
        using var client = configured.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/login");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type,x-bhome-client");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(allowed, response.Headers.Contains("Access-Control-Allow-Origin"));
        if (allowed)
        {
            Assert.Equal(origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
            Assert.Contains("POST", response.Headers.GetValues("Access-Control-Allow-Methods").Single());
            Assert.Contains("x-bhome-client", response.Headers.GetValues("Access-Control-Allow-Headers").Single(), StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task CorsDoesNotGrantAnonymousAccessToProtectedData()
    {
        using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((context, config) => config.AddJsonFile(
                Path.Combine(context.HostingEnvironment.ContentRootPath, "appsettings.Development.json"))));
        using var client = configured.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/operational-tasks");
        request.Headers.Add("Origin", "http://localhost:8081");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("http://localhost:8081", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(401, body.GetProperty("status").GetInt32());
    }
}
