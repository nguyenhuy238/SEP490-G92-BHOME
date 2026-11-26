using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests.Contracts;

public sealed class SigningRateLimitIsolationTests
{
    [Fact]
    public async Task AuthAndOwnerPollingCannotConsumeTheFirstInvitationReadOrOtpBudget()
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["AuthRateLimit:PermitLimit"] = "2", ["AuthRateLimit:WindowSeconds"] = "60" })));
        using var client = host.CreateClient();
        for (var i = 0; i < 3; i++) await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "invalid", password = "" });
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "invalid", password = "" })).StatusCode);
        for (var i = 0; i < 40; i++)
            Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.GetAsync($"/api/v1/contracts/{Guid.NewGuid()}/internal-signing")).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/contract-signing/info", new { token = "invalid" })).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/contract-signing/info", new { token = "invalid" })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/contract-signing/info", new { token = "invalid" })).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/contract-signing/otp", new { token = "invalid" })).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/contract-signing/verify", new { token = "invalid", otp = "000000" })).StatusCode);
    }
}
