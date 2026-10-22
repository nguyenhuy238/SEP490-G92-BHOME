using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

public sealed class ApiFoundationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory factory;
    private readonly HttpClient client;

    public ApiFoundationTests(ApiFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
    }

    [Fact]
    public async Task LivenessDoesNotRequireDatabaseOrAuthentication()
    {
        var response = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(Guid.TryParse(response.Headers.GetValues("X-Correlation-ID").Single(), out _));
    }

    [Fact]
    public async Task ProtectedControllerRejectsAnonymousWithProblemDetails()
    {
        var response = await client.GetAsync("/api/v1/session");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData(Roles.Owner, HttpStatusCode.OK)]
    [InlineData(Roles.Staff, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Tenant, HttpStatusCode.Forbidden)]
    public async Task SignedJwtUsesActualRoleAuthorization(string role, HttpStatusCode expected)
    {
        using var scope = factory.Services.CreateScope();
        var token = scope.ServiceProvider.GetRequiredService<IAccessTokenIssuer>().Issue(Guid.NewGuid(), [role]);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/test-probes/owner");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Value);
        Assert.Equal(expected, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task ValidationErrorsUseProblemDetailsAndCorrelation()
    {
        var response = await client.PostAsJsonAsync("/test-probes/validation", new { });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("errors", body);
        Assert.Contains(response.Headers.GetValues("X-Correlation-ID").Single(), body);
    }

    [Fact]
    public async Task InvalidJwtIsRejected()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/session");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "invalid.jwt.value");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
    }

    [Theory]
    [InlineData("/test-probes/error", HttpStatusCode.InternalServerError)]
    [InlineData("/test-probes/ocr", HttpStatusCode.ServiceUnavailable)]
    public async Task ErrorsAreSanitizedAndCorrelated(string path, HttpStatusCode expected)
    {
        var correlation = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Correlation-ID", correlation);
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains(correlation, body);
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body);
        Assert.DoesNotContain("stackTrace", body, StringComparison.OrdinalIgnoreCase);
    }
}
