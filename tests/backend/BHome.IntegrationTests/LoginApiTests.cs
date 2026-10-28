using System.Net;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

public sealed class LoginApiTests
{
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
            services.AddSingleton<ICredentialVerifier>(credentials)));
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
            services.AddSingleton<ICredentialVerifier>(new DeniedCredentials())));
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
