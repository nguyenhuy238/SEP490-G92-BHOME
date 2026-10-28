using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Ocr;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

// Test-only principal/resource/assignment adapters, never shipped or used as production auth evidence.
public sealed class OcrApiTests
{
    private static readonly Guid UserId = Guid.NewGuid();

    [Fact]
    public async Task DiagnosticsPreservesUnavailableFallbackInsteadOfPretendingRecognitionWorked()
    {
        using var root = new ApiFactory();
        using var configured = Configure(root, new TestResources(), new TestAssignments(), "Development", true);
        using var factory = configured.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => throw new IOException("synthetic private model path")), NullLogger<LocalOcrService>.Instance))));
        using var client = factory.CreateClient();
        using var request = Request("diagnostics/identity-front", Roles.Owner, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = System.Text.Json.JsonDocument.Parse(body);
        Assert.True(json.RootElement.GetProperty("proposal").GetProperty("isFallback").GetBoolean());
        Assert.Contains("ocr_unavailable", body);
        Assert.DoesNotContain("private model path", body);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Tenant, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Owner, HttpStatusCode.OK)]
    [InlineData(Roles.Staff, HttpStatusCode.OK)]
    public async Task DiagnosticsRequiresLoginAndOperationalRoleWithoutBusinessSetup(string? role, HttpStatusCode status)
    {
        using var root = new ApiFactory();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), "Development", true);
        using var client = factory.CreateClient();
        using var request = Request("diagnostics/identity-front", role, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(status, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        if (status == HttpStatusCode.OK)
        {
            using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal("000000000000", json.RootElement.GetProperty("proposal").GetProperty("proposedFields").GetProperty("citizenIdentityNumber").GetString());
            Assert.True(json.RootElement.GetProperty("elapsedMilliseconds").GetInt64() >= 0);
            Assert.DoesNotContain("sourceImageHash", await response.Content.ReadAsStringAsync());
        }
    }

    [Theory]
    [InlineData("Production", true)]
    [InlineData("Testing", true)]
    [InlineData("Development", false)]
    public async Task DiagnosticsCannotBeEnabledOutsideOptedInDevelopment(string environment, bool enabled)
    {
        using var root = new ApiFactory();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), environment, enabled);
        using var client = factory.CreateClient();
        using var request = Request("diagnostics/identity-front", Roles.Owner, []);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
        using var check = new HttpRequestMessage(HttpMethod.Get, "/api/v1/ocr/diagnostics");
        check.Headers.Add("X-Test-Role", Roles.Owner);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(check)).StatusCode);
    }

    [Theory]
    [InlineData("identity-front", OcrDocumentKind.IdentityFront)]
    [InlineData("identity-back", OcrDocumentKind.IdentityBack)]
    [InlineData("electricity-mechanical", OcrDocumentKind.MechanicalElectricity)]
    [InlineData("electricity-digital", OcrDocumentKind.DigitalElectricity)]
    [InlineData("water-mechanical", OcrDocumentKind.MechanicalWater)]
    [InlineData("water-digital", OcrDocumentKind.DigitalWater)]
    public async Task DiagnosticProfilesRunTheOcrService(string profile, OcrDocumentKind expectedKind)
    {
        using var root = new ApiFactory();
        var engine = new TestEngine();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), "Development", true, engine);
        using var client = factory.CreateClient();
        using var request = Request("diagnostics/" + profile, Roles.Owner, Image());
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(request)).StatusCode);
        Assert.Equal(expectedKind, engine.LastKind);
    }

    [Fact]
    public async Task DiagnosticsRejectsInvalidProfileInvalidImageOversizeAndMime()
    {
        using var root = new ApiFactory();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), "Development", true);
        using var client = factory.CreateClient();
        using var unknown = Request("diagnostics/0", Roles.Owner, Image());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(unknown)).StatusCode);
        using var invalid = Request("diagnostics/identity-front", Roles.Owner, "invalid"u8.ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
        using var oversized = Request("diagnostics/identity-front", Roles.Owner, new byte[5 * 1024 * 1024 + 1]);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await client.SendAsync(oversized)).StatusCode);
        using var mime = Request("diagnostics/identity-front", Roles.Owner, Image());
        mime.Content!.Headers.ContentType = new("application/pdf");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.SendAsync(mime)).StatusCode);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Tenant, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Staff, HttpStatusCode.OK)]
    [InlineData(Roles.Owner, HttpStatusCode.OK)]
    public async Task IdentityApiRestrictsRolesAndReturnsOnlyProposal(string? role, HttpStatusCode status)
    {
        var resources = new TestResources(); var assignments = new TestAssignments { Assigned = true };
        using var root = new ApiFactory();
        using var factory = Configure(root, resources, assignments);
        using var client = factory.CreateClient();
        using var request = Request($"identity/{resources.ResidentId}/front", role, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(status, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        if (status == HttpStatusCode.OK)
        {
            var result = await response.Content.ReadFromJsonAsync<OcrProposal>();
            Assert.True(result!.RequiresConfirmation); Assert.True(result.ManualEntryAvailable);
            Assert.Equal("000000000000", result.ProposedFields["citizenIdentityNumber"]);
        }
    }

    [Fact]
    public async Task CrossLocationMissingResourceAndClosedTaskAreRejected()
    {
        var resources = new TestResources(); var assignments = new TestAssignments();
        using var root = new ApiFactory(); using var factory = Configure(root, resources, assignments);
        using var client = factory.CreateClient();
        // Invalid bytes would return 400 if accidentally passed to the image pipeline.
        using var crossLocation = Request($"meter-tasks/{resources.TaskId}", Roles.Staff, []);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(crossLocation)).StatusCode);
        assignments.Assigned = true;
        using var missing = Request($"meter-tasks/{Guid.NewGuid()}", Roles.Staff, []);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(missing)).StatusCode);
        resources.Open = false;
        using var closed = Request($"meter-tasks/{resources.TaskId}", Roles.Staff, []);
        Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(closed)).StatusCode);
    }

    [Fact]
    public async Task InvalidOversizedAndWrongMimeBodiesAreRejected()
    {
        var resources = new TestResources();
        using var root = new ApiFactory(); using var factory = Configure(root, resources, new TestAssignments { Assigned = true });
        using var client = factory.CreateClient();
        using var invalid = Request($"meter-tasks/{resources.TaskId}", Roles.Staff, "not-image"u8.ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
        using var oversized = Request($"meter-tasks/{resources.TaskId}", Roles.Staff, new byte[5 * 1024 * 1024 + 1]);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await client.SendAsync(oversized)).StatusCode);
        using var mime = Request($"meter-tasks/{resources.TaskId}", Roles.Staff, Image());
        mime.Content!.Headers.ContentType = new("application/pdf");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.SendAsync(mime)).StatusCode);
    }

    [Theory]
    [InlineData("identity/{0}/front")]
    [InlineData("meter-tasks/{0}")]
    public async Task ProductionResourceAdapterFailsClosedWhenDatabaseIsUnavailable(string route)
    {
        using var root = new ApiFactory
        {
            ConnectionString = "Host=127.0.0.1;Port=1;Database=bhome_tests;Username=unconfigured;Timeout=1;Pooling=false"
        };
        using var factory = root.WithWebHostBuilder(builder => builder.ConfigureTestServices(AddTestAuthentication));
        using var client = factory.CreateClient();
        using var request = Request(string.Format(route, Guid.NewGuid()), Roles.Staff, []);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.DoesNotContain("resource lookup", await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain("bhome_tests", await response.Content.ReadAsStringAsync());
    }

    private static Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Configure(ApiFactory root, TestResources resources, TestAssignments assignments,
        string environment = "Testing", bool diagnosticEnabled = false, IOcrEngine? engine = null)
        => root.WithWebHostBuilder(builder => builder.UseEnvironment(environment)
        .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        { ["MobileDevelopment:Enabled"] = diagnosticEnabled.ToString() }))
        .ConfigureTestServices(services =>
        {
            AddTestAuthentication(services);
            services.AddSingleton<IOcrWorkflowResources>(resources);
            services.AddSingleton<IStaffLocationAccess>(assignments);
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => engine ?? new TestEngine()), NullLogger<LocalOcrService>.Instance));
        }));

    private static void AddTestAuthentication(IServiceCollection services)
    {
        services.AddAuthentication("OcrTest").AddScheme<AuthenticationSchemeOptions, TestAuthentication>("OcrTest", _ => { });
        services.AddSingleton<ISecurityAudit, TestAudit>();
    }

    private static HttpRequestMessage Request(string route, string? role, byte[] bytes)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/ocr/" + route) { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        if (role is not null) request.Headers.Add("X-Test-Role", role);
        return request;
    }

    private static byte[] Image()
    { using var image = new Mat(100, 100, MatType.CV_8UC3, Scalar.White); return image.ImEncode(".png"); }

    private sealed class TestResources : IOcrWorkflowResources
    {
        public Guid ResidentId { get; } = Guid.NewGuid(); public Guid TaskId { get; } = Guid.NewGuid();
        public bool Open { get; set; } = true;
        private readonly Guid locationId = Guid.NewGuid();
        public Task<OcrWorkflowResource?> FindIdentityAsync(Guid id, CancellationToken token)
            => Task.FromResult(id == ResidentId ? new OcrWorkflowResource(new(UserId, locationId, null), Open, OcrDocumentKind.IdentityFront) : null);
        public Task<OcrWorkflowResource?> FindMeterTaskAsync(Guid id, CancellationToken token)
            => Task.FromResult(id == TaskId ? new OcrWorkflowResource(new(UserId, locationId, null), Open, OcrDocumentKind.DigitalWater) : null);
    }

    private sealed class TestAssignments : IStaffLocationAccess
    {
        public bool Assigned { get; set; }
        public Task<bool> IsAssignedAsync(Guid staff, Guid owner, Guid location, CancellationToken token) => Task.FromResult(Assigned);
    }
    private sealed class TestEngine : IOcrEngine
    {
        public OcrDocumentKind? LastKind { get; private set; }
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
        {
            LastKind = kind;
            return Task.FromResult(new OcrText([new("000000000000", .9f)], "synthetic-test", []));
        }
    }
    private sealed class TestAudit : ISecurityAudit
    {
        public Task ForbiddenAsync(Guid? user, Guid? session, CancellationToken token) => Task.CompletedTask;
        public Task LoginFailedAsync(CancellationToken token) => Task.CompletedTask;
    }
    private sealed class TestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> settings,
        ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(settings, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-Role", out var role)) return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity([new Claim("sub", UserId.ToString()), new Claim("role", role.ToString())], "OcrTest", "sub", "role");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "OcrTest")));
        }
    }
}
