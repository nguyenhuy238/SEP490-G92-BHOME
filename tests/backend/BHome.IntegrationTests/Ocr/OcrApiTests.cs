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
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

// Test-only principal/resource/assignment adapters, never shipped or used as production auth evidence.
public sealed class OcrApiTests
{
    [LocalMeterModelsFact]
    public async Task RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var options = new OcrOptions { Enabled = true, ModelDirectory = Path.Combine(directory, ".tools/ocr-models"),
            MeterDetectionMinConfidence = .7f, MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true,
                ModelDirectory = Path.Combine(directory, ".tools/meter-detection-models") } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        using var root = new ApiFactory(); var resources = new TestResources();
        using var factory = Configure(root, resources, new TestAssignments(), "Development", true, engine);
        using var client = factory.CreateClient();
        using var frame = Cv2.ImRead(Path.Combine(directory, ".tools/meter-detection-all-test/wm_clean_000058.jpg"));
        using var resized = new Mat(); var ratio = Math.Min(1, 1600d / Math.Max(frame.Width, frame.Height));
        Cv2.Resize(frame, resized, new((int)(frame.Width * ratio), (int)(frame.Height * ratio)), 0, 0, InterpolationFlags.Area);
        using var request = Request("diagnostics/water-mechanical", Roles.Staff, resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85)));
        request.Content!.Headers.ContentType = new("image/jpeg");
        var response = await client.SendAsync(request); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("00431469", body.RootElement.GetProperty("proposal").GetProperty("proposedFields").GetProperty("reading").GetString());
        Assert.True(body.RootElement.GetProperty("proposal").GetProperty("requiresConfirmation").GetBoolean());
        using var electricRequest = Request("diagnostics/auto", Roles.Owner, await File.ReadAllBytesAsync(Path.Combine(directory, ".tools/ocr-real/meter.png")));
        var electric = await client.SendAsync(electricRequest); Assert.Equal(HttpStatusCode.OK, electric.StatusCode);
        using var electricBody = System.Text.Json.JsonDocument.Parse(await electric.Content.ReadAsStringAsync());
        var analysis = electricBody.RootElement.GetProperty("analysis");
        Assert.Equal("electricity_digital", analysis.GetProperty("detectedCategory").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, analysis.GetProperty("classificationConfidence").ValueKind);
        Assert.Equal(0, resources.Lookups); Assert.Contains("no-store", electric.Headers.CacheControl!.ToString());
        using var electricFrame = Cv2.ImRead(Path.Combine(directory, ".tools/ocr-real/meter.png"));
        using var upsideDown = new Mat(); Cv2.Rotate(electricFrame, upsideDown, RotateFlags.Rotate180);
        using var rotatedRequest = Request("diagnostics/auto", Roles.Owner, upsideDown.ImEncode(".png"));
        var rotated = await client.SendAsync(rotatedRequest); Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        using var rotatedBody = System.Text.Json.JsonDocument.Parse(await rotated.Content.ReadAsStringAsync());
        Assert.Equal("electricity_digital", rotatedBody.RootElement.GetProperty("analysis").GetProperty("detectedCategory").GetString());
    }
    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Tenant, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Owner, HttpStatusCode.OK)]
    [InlineData(Roles.Staff, HttpStatusCode.OK)]
    public async Task AutomaticDiagnosticsRequiresAuthorizedRoleAndNoSelectedProfile(string? role, HttpStatusCode status)
    {
        using var root = new ApiFactory();
        var engine = new TestEngine(); var resources = new TestResources();
        using var factory = Configure(root, resources, new TestAssignments(), "Development", true, engine);
        using var client = factory.CreateClient();
        using var request = Request("diagnostics/auto", role, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(status, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.Null(engine.LastKind);
        if (status == HttpStatusCode.OK)
        {
            var json = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            var analysis = json.GetProperty("analysis");
            Assert.Equal("cccd_front", analysis.GetProperty("detectedCategory").GetString());
            Assert.Equal("classified", analysis.GetProperty("classificationStatus").GetString());
            Assert.Equal(System.Text.Json.JsonValueKind.Null, analysis.GetProperty("classificationConfidence").ValueKind);
            Assert.Equal(System.Text.Json.JsonValueKind.Null, analysis.GetProperty("meterProposal").ValueKind);
            Assert.True(analysis.GetProperty("identityProposal").GetProperty("requiresConfirmation").GetBoolean());
            Assert.Equal(1, engine.AnalysisCalls);
            Assert.All(engine.Captured.ToArray(), value => Assert.Equal(0, value));
            Assert.Equal(0, resources.Lookups);
            Assert.DoesNotContain("sourceImageHash", await response.Content.ReadAsStringAsync());
        }
        else Assert.Equal(0, engine.AnalysisCalls);
    }

    [Theory]
    [InlineData("Production", true)]
    [InlineData("Development", false)]
    public async Task AutomaticDiagnosticsRemainsDevelopmentOptIn(string environment, bool enabled)
    {
        using var root = new ApiFactory(); var engine = new TestEngine();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), environment, enabled, engine);
        using var client = factory.CreateClient(); using var request = Request("diagnostics/auto", Roles.Owner, []);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
        Assert.Equal(0, engine.AnalysisCalls);
    }

    [Fact]
    public async Task AutomaticDiagnosticsRejectsInvalidImageAndMimeBeforeAnalysis()
    {
        using var root = new ApiFactory(); var engine = new TestEngine();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), "Development", true, engine);
        using var client = factory.CreateClient();
        using var invalid = Request("diagnostics/auto", Roles.Staff, "invalid"u8.ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
        using var oversized = Request("diagnostics/auto", Roles.Staff, new byte[5 * 1024 * 1024 + 1]);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await client.SendAsync(oversized)).StatusCode);
        using var mime = Request("diagnostics/auto", Roles.Staff, Image()); mime.Content!.Headers.ContentType = new("application/pdf");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.SendAsync(mime)).StatusCode);
        Assert.Equal(0, engine.AnalysisCalls);
    }

    private static readonly Guid UserId = Guid.NewGuid();

    [Theory]
    [InlineData("diagnostics/electricity-digital?decimalPlaces=1", HttpStatusCode.OK)]
    [InlineData("diagnostics/electricity-digital?decimalPlaces=5", HttpStatusCode.BadRequest)]
    [InlineData("diagnostics/electricity-digital?decimalPlaces=-1", HttpStatusCode.BadRequest)]
    [InlineData("diagnostics/identity-back?decimalPlaces=1", HttpStatusCode.BadRequest)]
    public async Task DiagnosticPrecisionIsExplicitValidatedAndMeterOnly(string route, HttpStatusCode expected)
    {
        using var root = new ApiFactory();
        var engine = new TestEngine();
        using var factory = Configure(root, new TestResources(), new TestAssignments(), "Development", true, engine);
        using var client = factory.CreateClient();
        using var request = Request(route, Roles.Staff, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(expected, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        if (expected == HttpStatusCode.OK)
        {
            using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var proposal = json.RootElement.GetProperty("proposal");
            Assert.Equal("00000000000.0", proposal.GetProperty("proposedFields").GetProperty("reading").GetString());
            Assert.True(proposal.GetProperty("requiresConfirmation").GetBoolean());
        }
        else Assert.Null(engine.LastKind);
    }

    [Fact]
    public async Task BusinessOcrIgnoresCallerPrecisionAndUsesTheServerMeter()
    {
        using var root = new ApiFactory();
        var resources = new TestResources { DecimalPlaces = 2 };
        using var factory = Configure(root, resources, new TestAssignments { Assigned = true });
        using var client = factory.CreateClient();
        using var request = Request($"meter-tasks/{resources.TaskId}?decimalPlaces=0", Roles.Staff, Image());
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("0000000000.00", json.RootElement.GetProperty("proposedFields").GetProperty("reading").GetString());
    }

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
        using var invalidPrecision = Request("diagnostics/electricity-digital?decimalPlaces=invalid", Roles.Owner, []);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(invalidPrecision)).StatusCode);
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
            // OcrWarmup resolves the engine registered by production. Keep these API tests
            // independent from the separately provisioned, git-ignored ONNX model files.
            services.RemoveAll<IOcrEngine>();
            services.AddSingleton<IOcrEngine>(_ => engine ?? new TestEngine());
            services.RemoveAll<Lazy<IOcrEngine>>();
            services.AddSingleton(provider => new Lazy<IOcrEngine>(provider.GetRequiredService<IOcrEngine>));
            services.AddSingleton<LocalOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => engine ?? new TestEngine()), NullLogger<LocalOcrService>.Instance));
            services.AddSingleton<IOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
            services.AddSingleton<IAutomaticOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
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
        public int? DecimalPlaces { get; set; }
        public int Lookups { get; private set; }
        private readonly Guid locationId = Guid.NewGuid();
        public Task<OcrWorkflowResource?> FindIdentityAsync(Guid id, CancellationToken token)
        { Lookups++; return Task.FromResult(id == ResidentId ? new OcrWorkflowResource(new(locationId, null), Open, OcrDocumentKind.IdentityFront) : null); }
        public Task<OcrWorkflowResource?> FindMeterTaskAsync(Guid id, CancellationToken token)
        { Lookups++; return Task.FromResult(id == TaskId ? new OcrWorkflowResource(new(locationId, null), Open, OcrDocumentKind.DigitalWater, DecimalPlaces) : null); }
    }

    private sealed class TestAssignments : IStaffLocationAccess
    {
        public bool Assigned { get; set; }
        public Task<bool> IsAssignedAsync(Guid staff, Guid location, CancellationToken token) => Task.FromResult(Assigned);
    }
    private sealed class TestEngine : IOcrEngine, IOcrAnalysisEngine
    {
        public int AnalysisCalls { get; private set; }
        public ReadOnlyMemory<byte> Captured { get; private set; }
        public Task<OcrImageAnalysis> AnalyzeAsync(ReadOnlyMemory<byte> image, CancellationToken token)
        {
            AnalysisCalls++; Captured = image;
            return Task.FromResult(new OcrImageAnalysis(new OcrText([
                new("CĂN CƯỚC CÔNG DÂN", .99f), new("Số: 000000000000", .99f),
                new("Họ và tên: NGƯỜI KIỂM THỬ", .99f), new("Ngày sinh: 01/02/2000", .99f)], "synthetic-test", [])));
        }
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
