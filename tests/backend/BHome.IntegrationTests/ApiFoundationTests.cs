using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests;

public sealed class ApiFoundationTests : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData("/api/v1/session", 401, "authentication_required")]
    [InlineData("/test-probes/stale-data", 409, "data_concurrency_conflict")]
    public async Task BinaryAcceptPreservesMiddlewareAndConcurrencyFeedback(string path, int status, string code)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Accept.ParseAdd("application/pdf");
        var response = await client.SendAsync(request);
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(code, body.GetProperty("code").GetString());
        Assert.Equal(response.Headers.GetValues("X-Correlation-ID").Single(), body.GetProperty("traceId").GetString());
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
    }

    [Fact]
    public async Task RateLimitWithBinaryAcceptReturns429AndLocalizedProblem()
    {
        await using var limited = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["AuthRateLimit:PermitLimit"] = "1" })));
        using var http = limited.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/test-probes/rate-limited")).StatusCode);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/test-probes/rate-limited");
        request.Headers.Accept.ParseAdd("application/pdf");
        var response = await http.SendAsync(request);
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("rate_limited", body.GetProperty("code").GetString());
        Assert.Contains("chờ", body.GetProperty("message").GetString());
    }
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
    [InlineData("/api/v1/invoice-adjustments/11111111-1111-1111-1111-111111111111/evidence/22222222-2222-2222-2222-222222222222")]
    [InlineData("/api/v1/refund-requests/11111111-1111-1111-1111-111111111111/evidence")]
    [InlineData("/api/v1/capture/readings/11111111-1111-1111-1111-111111111111/evidence")]
    public async Task PrivateEvidenceEndpointsStillRejectAnonymousBeforeObjectLookup(string path)
    {
        var response = await client.GetAsync(path);
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

    [Theory]
    [InlineData("/test-probes/private-object-missing", 404, "private_evidence_file_missing")]
    [InlineData("/test-probes/unrelated-file-missing", 500, "internal_error")]
    [InlineData("/test-probes/private-storage-unavailable", 503, "service_unavailable")]
    public async Task PrivateObjectNotFoundUsesSafeCodeWithoutChangingOtherErrorClassifications(
        string path, int expectedStatus, string? expectedCode)
    {
        var correlation = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        // Private evidence fetches can request binary; errors must remain ProblemDetails.
        request.Headers.Accept.ParseAdd("application/octet-stream");
        request.Headers.Add("X-Correlation-ID", correlation);
        var response = await client.SendAsync(request);
        Assert.Equal((HttpStatusCode)expectedStatus, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(expectedStatus, body.GetProperty("status").GetInt32());
        Assert.Equal(correlation, body.GetProperty("correlationId").GetString());
        if (expectedCode is null) Assert.False(body.TryGetProperty("code", out _));
        else Assert.Equal(expectedCode, body.GetProperty("code").GetString());
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        Assert.DoesNotContain("stackTrace", body.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.False(body.TryGetProperty("detail", out _));
    }

    [Theory]
    [InlineData("42703", false, 503)]
    [InlineData("42P01", false, 503)]
    [InlineData("42883", false, 503)]
    [InlineData("42703", true, 503)]
    public async Task SchemaMismatchIsUnavailableWithoutExposingDatabaseDetails(string state, bool wrapped, int status)
    {
        var response = await client.GetAsync($"/test-probes/schema-error/{state}/{wrapped}");
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(response.Headers.GetValues("X-Correlation-ID").Single(), body.GetProperty("correlationId").GetString());
        if (status == 503) Assert.Equal("database_schema_incompatible", body.GetProperty("code").GetString());
        else Assert.False(body.TryGetProperty("code", out _));
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        Assert.False(body.TryGetProperty("exception", out _));
    }

    [Theory]
    [InlineData(400)]
    [InlineData(403)]
    [InlineData(404)]
    [InlineData(409)]
    public async Task PropertyRejectionsPreserveStatusSafeCodeAndCorrelation(int status)
    {
        var correlation = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/test-probes/property-error/{status}");
        request.Headers.Add("X-Correlation-ID", correlation);
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(status, body.GetProperty("status").GetInt32());
        Assert.Equal("synthetic_property_rejection", body.GetProperty("code").GetString());
        Assert.Equal(correlation, body.GetProperty("correlationId").GetString());
        Assert.False(body.TryGetProperty("stackTrace", out _));
        Assert.False(body.TryGetProperty("detail", out _));
    }

    [Theory]
    [InlineData("/test-probes/property-error/400", 400, "application/pdf")]
    [InlineData("/test-probes/property-error/403", 403, "application/octet-stream")]
    [InlineData("/test-probes/property-error/404", 404, "image/jpeg")]
    [InlineData("/test-probes/property-error/409", 409, "application/pdf")]
    [InlineData("/test-probes/error", 500, "application/pdf")]
    public async Task BinaryAcceptPreservesProblemStatusInsteadOfThrowingAnotherException(string path, int status, string accept)
    {
        var correlation = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Accept.ParseAdd(accept);
        request.Headers.Add("X-Correlation-ID", correlation);
        var response = await client.SendAsync(request);
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(status, body.GetProperty("status").GetInt32());
        Assert.Equal(correlation, body.GetProperty("correlationId").GetString());
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        Assert.False(body.TryGetProperty("exception", out _));
    }

    [Theory]
    [InlineData("23505", 409, "data_unique_conflict")]
    [InlineData("23503", 409, "data_reference_conflict")]
    [InlineData("23514", 500, "internal_error")]
    [InlineData("23502", 500, "internal_error")]
    [InlineData("23P01", 409, "data_overlap_conflict")]
    [InlineData("40001", 409, "data_concurrency_conflict")]
    [InlineData("40P01", 409, "data_concurrency_conflict")]
    [InlineData("42601", 500, "internal_error")]
    public async Task DatabaseRejectionsAreClassifiedWithoutLeakingSql(string state, int status, string code)
    {
        foreach (var wrapped in new[] { false, true })
        {
            var response = await client.GetAsync($"/test-probes/schema-error/{state}/{wrapped}");
            Assert.Equal((HttpStatusCode)status, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            Assert.Equal(code, body.GetProperty("code").GetString());
            Assert.Equal(body.GetProperty("correlationId").GetString(), body.GetProperty("traceId").GetString());
            Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("message").GetString()));
            Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        }
    }

    [Theory]
    [InlineData("ck_resident_actual_dates")]
    [InlineData("ck_billing_policy_calculation_method")]
    public async Task KnownInputConstraintsHaveSafeValidationFeedback(string constraint)
    {
        var response = await client.GetAsync($"/test-probes/schema-error/23514/true?constraintName={constraint}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("data_constraint_invalid", body.GetProperty("code").GetString());
        Assert.DoesNotContain(constraint, body.ToString());
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
    }

    [Fact]
    public async Task StaffValidationReturnsAllLocalizedFieldErrorsAndRetainsLegacyErrors()
    {
        var response = await client.PostAsJsonAsync("/test-probes/staff-validation", new
        {
            email = "invalid",
            phone = "abc",
            fullName = "",
            employment = new { startDate = "2026-01-01", status = "Unknown" }
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("validation_error", body.GetProperty("code").GetString());
        var fields = body.GetProperty("fieldErrors");
        Assert.Equal("invalid_email_format", fields.GetProperty("email")[0].GetProperty("code").GetString());
        Assert.Equal("required_field", fields.GetProperty("fullName")[0].GetProperty("code").GetString());
        Assert.Equal("invalid_phone_number", fields.GetProperty("phone")[0].GetProperty("code").GetString());
        Assert.True(fields.TryGetProperty("employment.status", out _));
        Assert.True(body.GetProperty("errors").EnumerateObject().Count() >= 3);
        Assert.DoesNotContain("The field", body.ToString());
    }

    [Theory]
    [InlineData("{\"email\":\"private@example.invalid\",\"employment\":{\"startDate\":\"PRIVATE_TEST_DETAIL\"}}")]
    [InlineData("{\"email\":\"private@example.invalid\",\"employment\":{\"baseRate\":\"bí mật PRIVATE_TEST_DETAIL\"}}")]
    [InlineData("{broken PRIVATE_TEST_DETAIL")]
    public async Task BindingErrorsNeverEchoRejectedValues(string json)
    {
        var response = await client.PostAsync("/test-probes/staff-validation", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", text);
        Assert.DoesNotContain("private@example.invalid", text);
        Assert.DoesNotContain("System.", text);
        Assert.Contains("fieldErrors", text);
    }

    [Fact]
    public async Task MissingNestedRequiredObjectIsReportedAsRequiredInsteadOfAFormatError()
    {
        var response = await client.PostAsJsonAsync("/test-probes/staff-validation", new { email = "synthetic@example.invalid", fullName = "Synthetic" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("required_field", body.GetProperty("fieldErrors").GetProperty("employment")[0].GetProperty("code").GetString());
    }

    [Fact]
    public async Task OcrControllerPreservesTheInputCodeInsteadOfReplacingItWithInvalidRequest()
    {
        var response = await client.PostAsync("/test-probes/ocr-invalid-side", null);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("invalid_identity_side", body.GetProperty("code").GetString());
        Assert.Contains("mặt trước", body.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("missing_image", 400, "Chọn ảnh")]
    [InlineData("image_too_large", 413, "giới hạn")]
    [InlineData("unsupported_image_format", 400, "PNG hoặc JPEG")]
    public async Task OcrInputRejectionsKeepActionableCatalogMessagesAndStatus(string code, int status, string expected)
    {
        var response = await client.GetAsync($"/test-probes/ocr-input/{code}");
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(code, body.GetProperty("code").GetString());
        Assert.Contains(expected, body.GetProperty("message").GetString());
        Assert.Equal(body.GetProperty("traceId").GetString(), body.GetProperty("correlationId").GetString());
    }

    [Fact]
    public async Task OcrStateConflictKeepsItsWorkflowCode()
    {
        var response = await client.GetAsync("/test-probes/ocr-workflow-state");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("ocr_workflow_state_conflict", body.GetProperty("code").GetString());
        Assert.Contains("Tác vụ", body.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("Unauthenticated", 401)]
    [InlineData("Forbidden", 403)]
    [InlineData("NotFound", 404)]
    [InlineData("ProviderUnavailable", 503)]
    public async Task SigningRejectionsDoNotExposeExceptionDetails(string error, int status)
    {
        var response = await client.GetAsync($"/test-probes/signing-error/{error}");
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(body.TryGetProperty("detail", out _));
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        Assert.Equal("digital_signing_" + error.ToLowerInvariant(), body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task SigningValidationStillShowsTheIntentionallySafeUseCaseMessage()
    {
        var response = await client.GetAsync("/test-probes/signing-error/Invalid");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("Ảnh phải có nền trong suốt.", body.GetProperty("message").GetString());
        Assert.False(body.TryGetProperty("detail", out _));
    }

    [Fact]
    public async Task SmsPasswordMismatchTargetsConfirmPasswordBeforeRecoveryIsCalled()
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/sms-recovery/reset", new
        {
            identifier = "synthetic@example.invalid",
            challengeId = Guid.NewGuid(),
            authorization = "synthetic-grant",
            newPassword = "Synthetic-Password-2026",
            confirmPassword = "Different-Password-2026"
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("validation_error", body.GetProperty("code").GetString());
        var error = body.GetProperty("fieldErrors").GetProperty("confirmPassword")[0];
        Assert.Equal("password_mismatch", error.GetProperty("code").GetString());
        Assert.Equal("Mật khẩu xác nhận không khớp.", error.GetProperty("message").GetString());
        Assert.True(body.GetProperty("errors").TryGetProperty("ConfirmPassword", out _));
        Assert.DoesNotContain("Synthetic-Password-2026", body.ToString());
        Assert.DoesNotContain("Different-Password-2026", body.ToString());
    }

    [Fact]
    public async Task LoginPhoneFormatUsesThePhoneErrorCode()
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { phone = "abc", password = "Synthetic-Password-2026" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("invalid_phone_number", body.GetProperty("fieldErrors").GetProperty("phone")[0].GetProperty("code").GetString());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CaptureAccountIdentityErrorsCannotLeakDescriptionsOrUntrustedCodes(bool known)
    {
        var response = await client.GetAsync($"/test-probes/capture-account-error/{known}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(known ? "validation_error" : "staff_account_invalid", body.GetProperty("code").GetString());
        if (known)
        {
            var fields = body.GetProperty("fieldErrors");
            Assert.Contains("đã được sử dụng", fields.GetProperty("email")[0].GetProperty("message").GetString());
            Assert.Contains("bảo mật", fields.GetProperty("password")[0].GetProperty("message").GetString());
        }
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", body.ToString());
        Assert.DoesNotContain("synthetic@example.invalid", body.ToString());
        Assert.False(body.TryGetProperty("detail", out _));
    }
}
