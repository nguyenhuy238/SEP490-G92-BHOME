using System.Net;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection.Extensions;
using System.Text.Json;

namespace BHome.IntegrationTests;

public sealed class LoginApiTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SuccessfulLoginReturnsOnlyTransportCredentials(bool web)
    {
        using var factory = new ApiFactory();
        var session = new LoginResult(Guid.NewGuid(), [Roles.Owner], "header.payload.signature",
            DateTimeOffset.UtcNow.AddMinutes(30), Guid.NewGuid(), "synthetic-refresh",
            DateTimeOffset.UtcNow.AddDays(7));
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<ICredentialVerifier>();
            services.RemoveAll<IAuthenticationSessions>();
            services.AddSingleton<ICredentialVerifier>(new AllowedCredentials(session.UserId));
            services.AddSingleton<IAuthenticationSessions>(new FixedSessions(session));
        }));
        using var client = host.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new { email = "synthetic@example.invalid", password = "synthetic-password" })
        };
        if (web)
        {
            request.Headers.Add("X-BHome-Client", "web");
            request.Headers.Add("Origin", "https://localhost");
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var names = body.RootElement.EnumerateObject().Select(property => property.Name).Order().ToArray();
        Assert.Equal(web ? ["accessToken"] : ["accessToken", "refreshToken"], names);
    }

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
                Content = JsonContent.Create(new { email = "synthetic@example.invalid", password = "wrong-password" })
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
    [InlineData("username-only", "password")]
    [InlineData("0900000000", "password")]
    [InlineData("invalid@@example.invalid", "password")]
    [InlineData("user@example.invalid", null)]
    [InlineData("user@example.invalid", "")]
    public async Task InvalidInputReturnsValidationProblemBeforeCredentialLookup(string? email, string? password)
    {
        using var factory = new ApiFactory();
        var credentials = new DeniedCredentials();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ICredentialVerifier>(credentials);
            services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
        }));
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });

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

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "private@example.invalid", password = "private-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Sign-in failed.", body);
        Assert.Contains(response.Headers.GetValues("X-Correlation-ID").Single(), body);
        Assert.DoesNotContain("private@example.invalid", body);
        Assert.DoesNotContain("private-password", body);
    }

    [Fact]
    public async Task LegacyUserNamePayloadCannotSelectAnAccount()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { userName = "synthetic@example.invalid", password = "synthetic-password" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PhonePayloadReachesCredentialVerification()
    {
        using var factory = new ApiFactory(); var credentials = new DeniedCredentials();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ICredentialVerifier>(credentials);
            services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
        }));
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { phone = "090-123 4567", password = "synthetic-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1, credentials.Calls);
    }

    [Fact]
    public async Task EmailAndPhoneTogetherAreRejectedBeforeCredentialVerification()
    {
        using var factory = new ApiFactory(); var credentials = new DeniedCredentials();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ICredentialVerifier>(credentials);
            services.AddSingleton<ISecurityAudit>(new TestSecurityAudit());
        }));
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = "synthetic@example.invalid", phone = "0901234567", password = "synthetic-password" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, credentials.Calls);
    }

    private sealed class TestSecurityAudit : ISecurityAudit
    {
        public Task LoginFailedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ForbiddenAsync(Guid? userId, Guid? sessionId, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class DeniedCredentials : ICredentialVerifier
    {
        public int Calls { get; private set; }
        public Task<VerifiedIdentity?> VerifyAsync(string email, string password, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult<VerifiedIdentity?>(null);
        }
    }

    private sealed class AllowedCredentials(Guid userId) : ICredentialVerifier
    {
        public Task<VerifiedIdentity?> VerifyAsync(string identifier, string password, CancellationToken cancellationToken) =>
            Task.FromResult<VerifiedIdentity?>(new VerifiedIdentity(userId, [Roles.Owner], "synthetic-stamp"));
    }

    private sealed class FixedSessions(LoginResult session) : IAuthenticationSessions
    {
        public Task<LoginResult?> CreateAsync(VerifiedIdentity identity, string? device, CancellationToken cancellationToken) =>
            Task.FromResult<LoginResult?>(session);
        public Task<LoginResult?> RefreshAsync(string token, CancellationToken cancellationToken) =>
            Task.FromResult<LoginResult?>(session);
        public Task RevokeAsync(Guid userId, Guid sessionId, bool allDevices, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task<bool> ValidateAsync(SessionIdentity identity, string securityStamp, CancellationToken cancellationToken) => Task.FromResult(true);
    }
}
