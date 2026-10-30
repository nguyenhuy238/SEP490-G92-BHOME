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
    public async Task ReadinessRejectsUnavailableDatabase()
    {
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedControllerRejectsAnonymousWithProblemDetails()
    {
        var response = await client.GetAsync("/api/v1/session");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData(Roles.Owner)]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task SignedJwtWithoutDurableSessionCannotAuthorizeAnyRole(string role)
    {
        using var scope = factory.Services.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<BHome.Infrastructure.IdentityAccess.JwtOptions>>().Value;
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(
            new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(settings.Issuer, settings.Audience,
                [new System.Security.Claims.Claim("sub", Guid.NewGuid().ToString()), new System.Security.Claims.Claim("role", role)],
                DateTime.UtcNow.AddSeconds(-1), DateTime.UtcNow.AddMinutes(5),
                new Microsoft.IdentityModel.Tokens.SigningCredentials(
                    new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(settings.SigningKey)),
                    Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256)));
        using var request = new HttpRequestMessage(HttpMethod.Get, "/test-probes/owner");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
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
    [InlineData("/test-probes/oversized", HttpStatusCode.RequestEntityTooLarge)]
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
