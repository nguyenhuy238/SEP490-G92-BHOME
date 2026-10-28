using System.Net;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests;

public sealed class LoginApiTests
{
    [Fact]
    public async Task SourceRateLimitRejectsBeforeCredentialLookupAndIgnoresUntrustedForwardedHeaders()
    {
        using var factory = new ApiFactory();
        var credentials = new DeniedCredentials();
        using var host = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AuthRateLimit:PermitLimit"] = "2",
                ["AuthRateLimit:WindowSeconds"] = "60"
            }));
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ICredentialVerifier>(credentials);
                services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
            });
        });
        using var client = host.CreateClient();
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
            {
                Content = JsonContent.Create(new { userName = "synthetic", password = "wrong-password" })
            };
            request.Headers.Add("X-Forwarded-For", $"192.0.2.{attempt + 1}");
            var response = await client.SendAsync(request);
            Assert.Equal(attempt < 2 ? HttpStatusCode.Unauthorized : HttpStatusCode.TooManyRequests, response.StatusCode);
            Assert.True(response.Headers.CacheControl?.NoStore);
            if (attempt == 2)
            {
                Assert.NotNull(response.Headers.RetryAfter);
                Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            }
        }
        Assert.Equal(2, credentials.Calls);
    }

    [Theory]
    [InlineData(null, "password")]
    [InlineData("", "password")]
    [InlineData(" ", "password")]
    [InlineData("user", null)]
    [InlineData("user", "")]
    public async Task InvalidInputReturnsValidationProblemBeforeCredentialLookup(string? userName, string? password)
    {
        using var factory = new ApiFactory();
        var credentials = new DeniedCredentials();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ICredentialVerifier>(credentials);
            services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
        }));
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { userName, password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("errors", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, credentials.Calls);
    }

    [Fact]
    public async Task CredentialFailureIsGenericCorrelatedAndNotCached()
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ICredentialVerifier>(new DeniedCredentials());
            services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
        }));
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { userName = "private-name", password = "private-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Sign-in failed.", body);
        Assert.Contains(response.Headers.GetValues("X-Correlation-ID").Single(), body);
        Assert.DoesNotContain("private-name", body);
        Assert.DoesNotContain("private-password", body);
    }

    private sealed class TestSecurityAudit : ISecurityAudit
    {
        public Task LoginFailedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ForbiddenAsync(Guid? userId, Guid? sessionId, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class DeniedCredentials : ICredentialVerifier
    {
        public int Calls { get; private set; }
        public Task<VerifiedIdentity?> VerifyAsync(string userName, string password, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult<VerifiedIdentity?>(null);
        }
    }
}
