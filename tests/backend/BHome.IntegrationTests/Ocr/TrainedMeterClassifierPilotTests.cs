using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Ocr;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

// Opt-in real checkpoint/ONNX verification. These are training-set pipeline
// checks, not an independent accuracy benchmark or physical camera test.
public sealed class TrainedMeterClassifierPilotTests
{
    private static string Root => Path.GetFullPath(Environment.GetEnvironmentVariable("BHOME_METER_CLASSIFIER_PILOT_ROOT")!);
    private static string Export => Path.Combine(Root, "export_100epochs");
    private static JsonDocument Evaluation() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Export, "evaluation.json")));
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private static OcrOptions Options(JsonDocument evaluation) => new()
    {
        Enabled = true,
        VisualClassifier = new()
        {
            Enabled = true,
            ModelPath = Path.Combine(Export, "body.onnx"),
            Sha256 = evaluation.RootElement.GetProperty("onnxSha256").GetString()!
        }
    };

    private static byte[] Image(JsonElement sample)
    {
        var path = Path.GetFullPath(Path.Combine(Root, "dataset", sample.GetProperty("image").GetString()!));
        Assert.StartsWith(Path.Combine(Root, "dataset") + Path.DirectorySeparatorChar, path);
        var bytes = File.ReadAllBytes(path);
        Assert.Equal(sample.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
        return bytes;
    }

    [MeterClassifierPilotFact]
    public void RealNineImageCheckpointMatchesPythonPreprocessingClassOrderAndDecisions()
    {
        using var evaluation = Evaluation();
        var options = Options(evaluation);
        using var classifier = new YoloMeterCategoryClassifier(options, development: true);
        var rows = new List<object>();
        foreach (var sample in evaluation.RootElement.GetProperty("rows").EnumerateArray())
        {
            using var image = Cv2.ImDecode(Image(sample), ImreadModes.Color);
            var pixels = YoloMeterSceneDetector.Letterbox(image, out _, out _, out _, size: 416);
            var referenceBytes = File.ReadAllBytes(Path.Combine(Export, sample.GetProperty("id").GetString() + ".f32"));
            Assert.Equal(sample.GetProperty("tensorSha256").GetString(), Convert.ToHexString(SHA256.HashData(referenceBytes)).ToLowerInvariant());
            var expectedPixels = new float[referenceBytes.Length / sizeof(float)];
            Buffer.BlockCopy(referenceBytes, 0, expectedPixels, 0, referenceBytes.Length);
            Assert.Equal(expectedPixels.Length, pixels.Length);
            var delta = pixels.Buffer.Span.ToArray().Zip(expectedPixels, (a, b) => Math.Abs(a - b)).Max();
            Assert.InRange(delta, 0, 1e-6f);
            pixels.Buffer.Span.Clear();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            var decision = classifier.Classify(image, default)!;
            watch.Stop();
            Assert.Equal("classified", decision.Status);
            Assert.Equal("visual_model", decision.Source);
            Assert.Equal(sample.GetProperty("expected").GetString(), OcrCategories.Name(decision.Kind!.Value));
            Assert.InRange(Math.Abs(decision.Confidence!.Value - sample.GetProperty("confidence").GetSingle()), 0, 2e-4f);
            using var jpeg = Cv2.ImDecode(image.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85)), ImreadModes.Color);
            var jpegDecision = classifier.Classify(jpeg, default)!;
            Assert.Equal("classified", jpegDecision.Status);
            Assert.Equal(decision.Kind, jpegDecision.Kind);
            rows.Add(new { id = sample.GetProperty("id").GetString(), category = OcrCategories.Name(decision.Kind.Value), decision.Confidence, jpegConfidence = jpegDecision.Confidence, elapsedMs = watch.Elapsed.TotalMilliseconds, maximumPixelDelta = delta });
        }
        Assert.Equal(9, rows.Count);
        File.WriteAllText(Path.Combine(Root, "backend_classifier_results.json"), JsonSerializer.Serialize(new { scope = "IN_SAMPLE_REAL_ONNX_DOTNET", rows }, Json));
    }

    [MeterClassifierPilotFact]
    public async Task RealDiClassifierFlowsThroughStaffImageHttpWithoutAutoConfirmationOrMetadataLabels()
    {
        using var evaluation = Evaluation();
        var configured = Options(evaluation);
        var repository = new DirectoryInfo(Root);
        while (repository is not null && !Directory.Exists(Path.Combine(repository.FullName, ".git"))) repository = repository.Parent;
        Assert.NotNull(repository);
        var resources = new Resources();
        var assignments = new Assignments(resources.LocationId);
        using var root = new ApiFactory();
        using var factory = root.WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ocr:Enabled"] = "true",
                ["Ocr:ModelDirectory"] = Path.Combine(repository.FullName, ".tools", "ocr-models"),
                ["Ocr:TimeoutMilliseconds"] = "9000",
                ["Ocr:VisualClassifier:Enabled"] = "true",
                ["Ocr:VisualClassifier:ModelPath"] = configured.VisualClassifier.ModelPath,
                ["Ocr:VisualClassifier:Sha256"] = configured.VisualClassifier.Sha256,
                ["Ocr:AutomaticClassificationMinConfidence"] = ".9",
                ["Ocr:VisualClassifier:CandidateThreshold"] = ".25",
                ["Ocr:VisualClassifier:NmsThreshold"] = ".45",
                ["Ocr:ExperimentalMeter:Enabled"] = "false",
                ["Ocr:MeterDetector:Enabled"] = "true",
                ["Ocr:MeterDetector:WaterDigitsEnabled"] = "true",
                ["Ocr:MeterDetector:ModelDirectory"] = Path.Combine(repository.FullName, ".tools", "meter-detection-models"),
                ["Ocr:MeterDetectionMinConfidence"] = ".7"
            }))
            .ConfigureTestServices(services =>
            {
                OcrApiTests.AddTestAuthentication(services);
                services.AddSingleton<IOcrWorkflowResources>(resources);
                services.AddSingleton<IStaffLocationAccess>(assignments);
            }));
        using var client = factory.CreateClient();
        using var rollbackFactory = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["Ocr:VisualClassifier:Enabled"] = "false" })));
        using var rollbackClient = rollbackFactory.CreateClient();
        Assert.IsType<YoloMeterCategoryClassifier>(factory.Services.GetRequiredService<IImageCategoryClassifier>());
        Assert.IsType<OnnxOcrEngine>(factory.Services.GetRequiredService<IOcrEngine>());
        var results = new List<object>();
        foreach (var sample in evaluation.RootElement.GetProperty("rows").EnumerateArray())
        {
            var category = sample.GetProperty("expected").GetString()!;
            resources.Kind = YoloMeterCategoryClassifier.Categories.Single(k => OcrCategories.Name(k) == category);
            var response = await Upload(Image(sample), Roles.Staff);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var proposal = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
            using var baselineResponse = await Upload(Image(sample), Roles.Staff, rollbackClient);
            Assert.Equal(HttpStatusCode.OK, baselineResponse.StatusCode);
            var baseline = (await baselineResponse.Content.ReadFromJsonAsync<OcrProposal>())!;
            Assert.Equal(baseline.ProposedFields.OrderBy(p => p.Key), proposal.ProposedFields.OrderBy(p => p.Key));
            Assert.Equal(baseline.IsFallback, proposal.IsFallback);
            Assert.True(proposal.RequiresConfirmation);
            Assert.DoesNotContain("meter_type_mismatch", proposal.Warnings);
            Assert.DoesNotContain("visual_classifier_unavailable", proposal.Warnings);
            Assert.DoesNotContain("ocr_timeout", proposal.Warnings);
            Assert.DoesNotContain("ocr_unavailable", proposal.Warnings);
            Assert.Equal(proposal.ProposedFields.OrderBy(p => p.Key), resources.LastProposal!.ProposedFields.OrderBy(p => p.Key));
            Assert.True(resources.LastProposal.RequiresConfirmation);
            Assert.True(resources.CanCapture);
            Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
            results.Add(new { imageId = sample.GetProperty("id").GetString(), taskCategory = category, proposal, baselineProposal = baseline });
            response.Dispose();
        }

        // Same water pixels with trusted electricity metadata: metadata cannot
        // manufacture an electricity classification or a reading.
        resources.Kind = OcrDocumentKind.DigitalElectricity;
        var water = evaluation.RootElement.GetProperty("rows").EnumerateArray().Single(s => s.GetProperty("id").GetString() == "meter_007");
        using var mismatch = await Upload(Image(water), Roles.Staff);
        var rejected = (await mismatch.Content.ReadFromJsonAsync<OcrProposal>())!;
        Assert.True(rejected.IsFallback);
        Assert.Empty(rejected.ProposedFields);
        Assert.Contains("meter_type_mismatch", rejected.Warnings);
        Assert.True(rejected.RequiresConfirmation);
        Assert.True(resources.CanCapture);
        foreach (var probe in evaluation.RootElement.GetProperty("negativeSafetyProbes").EnumerateArray())
        {
            var bytes = File.ReadAllBytes(Path.Combine(Export, probe.GetProperty("id").GetString() + ".png"));
            using var image = Cv2.ImDecode(bytes, ImreadModes.Color);
            var unknown = factory.Services.GetRequiredService<IImageCategoryClassifier>().Classify(image, default)!;
            Assert.Null(unknown.Kind);
            using var response = await Upload(bytes, Roles.Staff);
            var fallback = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
            Assert.True(fallback.IsFallback);
            Assert.Empty(fallback.ProposedFields);
            Assert.True(fallback.RequiresConfirmation);
            results.Add(new { safetyProbe = probe.GetProperty("id").GetString(), unknown.Status, proposal = fallback });
        }
        var calls = resources.Proposals;
        using var unauthorized = await Upload(Image(water), null);
        using var tenant = await Upload(Image(water), Roles.Tenant);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, tenant.StatusCode);
        Assert.Equal(calls, resources.Proposals);
        assignments.Assigned = false;
        using var crossLocation = await Upload(Image(water), Roles.Staff);
        Assert.Equal(HttpStatusCode.NotFound, crossLocation.StatusCode);
        Assert.Equal(calls, resources.Proposals);
        assignments.Assigned = true;
        await VerifyActualMobileClient(repository.FullName, client, rollbackClient, resources, evaluation);
        File.WriteAllText(Path.Combine(Root, "backend_api_results.json"), JsonSerializer.Serialize(new
        {
            scope = "IN_SAMPLE_REAL_DI_ONNX_PP_OCR_HTTP_TESTSERVER",
            limitation = "Synthetic authentication, task resource and assignment boundaries; no physical camera, database confirmation or real storage exercised",
            results,
            mismatch = rejected,
            unauthorizedStatus = (int)unauthorized.StatusCode,
            tenantStatus = (int)tenant.StatusCode,
            crossLocationStatus = (int)crossLocation.StatusCode,
            automaticallyConfirmed = false
        }, Json));

        async Task<HttpResponseMessage> Upload(byte[] bytes, string? role, HttpClient? target = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/ocr/meter-tasks/{resources.TaskId}") { Content = new ByteArrayContent(bytes) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg"); // Same binary transport as MobileApi.image.
            if (role is not null) request.Headers.Add("X-Test-Role", role);
            return await (target ?? client).SendAsync(request);
        }
    }

    private static async Task VerifyActualMobileClient(string repository, HttpClient backend, HttpClient rollback, Resources resources, JsonDocument evaluation)
    {
        var bundle = Path.Combine(Root, "mobile-client.mjs");
        Assert.True(File.Exists(bundle), "Build the actual MobileApi client with build_mobile_client.mjs before enabling pilot verification.");
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new("1.3.6.1.5.5.7.3.1") }, true));
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName("localhost"); names.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(names.Build());
        using var generated = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(1));
        // SChannel needs a key container for server TLS on Windows. The default
        // import owns a temporary container deleted on Dispose; no PFX artifact
        // or trusted certificate is installed. Only the public PEM reaches Node.
        using var certificate = new X509Certificate2(generated.Export(X509ContentType.Pfx));
        var certificatePath = Path.Combine(Root, "mobile-test-public-certificate.pem");
        await File.WriteAllTextAsync(certificatePath, certificate.ExportCertificatePem());
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0, endpoint => endpoint.UseHttps(certificate)));
        await using var bridge = builder.Build();
        // TLS transport bridge to the real ASP.NET TestServer application. No
        // mocked responses or model replacements; authentication/resources
        // remain the explicit test-only adapters configured by the caller.
        bridge.Run(async context =>
        {
            using var forwarded = new HttpRequestMessage(new HttpMethod(context.Request.Method), context.Request.Path + context.Request.QueryString)
            { Content = new StreamContent(context.Request.Body) };
            forwarded.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType!);
            if (context.Request.Headers.TryGetValue("X-Test-Role", out var role)) forwarded.Headers.Add("X-Test-Role", role.ToString());
            using var response = await backend.SendAsync(forwarded, context.RequestAborted);
            context.Response.StatusCode = (int)response.StatusCode;
            context.Response.ContentType = response.Content.Headers.ContentType?.ToString();
            await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
        });
        await bridge.StartAsync();
        try
        {
            var origin = bridge.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            var results = new List<object>();
            foreach (var id in new[] { "meter_002", "meter_003", "meter_007", "meter_008" })
            {
                var sample = evaluation.RootElement.GetProperty("rows").EnumerateArray().Single(s => s.GetProperty("id").GetString() == id);
                resources.Kind = YoloMeterCategoryClassifier.Categories.Single(k => OcrCategories.Name(k) == sample.GetProperty("expected").GetString());
                var jpeg = JpegUpload(Path.Combine(Root, "dataset", sample.GetProperty("image").GetString()!));
                var proposal = await Upload(jpeg);
                using var baselineRequest = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/ocr/meter-tasks/{resources.TaskId}")
                { Content = new ByteArrayContent(await File.ReadAllBytesAsync(jpeg)) };
                baselineRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
                baselineRequest.Headers.Add("X-Test-Role", Roles.Staff);
                using var baselineResponse = await rollback.SendAsync(baselineRequest);
                Assert.Equal(HttpStatusCode.OK, baselineResponse.StatusCode);
                var baseline = (await baselineResponse.Content.ReadFromJsonAsync<OcrProposal>())!;
                Assert.Equal(baseline.ProposedFields.OrderBy(p => p.Key), proposal.ProposedFields.OrderBy(p => p.Key));
                Assert.Equal(baseline.IsFallback, proposal.IsFallback);
                Assert.True(proposal.RequiresConfirmation);
                Assert.DoesNotContain("meter_type_mismatch", proposal.Warnings);
                Assert.DoesNotContain("ocr_unavailable", proposal.Warnings);
                results.Add(new { scenario = id, proposal, baselineProposal = baseline });
            }
            resources.Kind = OcrDocumentKind.DigitalElectricity;
            var mismatch = await Upload(JpegUpload(Path.Combine(Root, "dataset/images/train/meter_007.png")));
            Assert.Contains("meter_type_mismatch", mismatch.Warnings);
            Assert.Empty(mismatch.ProposedFields);
            results.Add(new { scenario = "water_uploaded_to_electricity_task", proposal = mismatch });
            var unknown = await Upload(JpegUpload(Path.Combine(Export, "blank_white.png")));
            Assert.True(unknown.IsFallback);
            Assert.Empty(unknown.ProposedFields);
            results.Add(new { scenario = "unknown_blank_image", proposal = unknown });
            await File.WriteAllTextAsync(Path.Combine(Root, "mobile_backend_results.json"), JsonSerializer.Serialize(new
            {
                execution = "Actual MobileApi TypeScript bundle -> Node fetch HTTPS -> loopback Kestrel transport bridge -> ASP.NET API/DI -> real trained ONNX + real PP OCR",
                limitation = "No Expo runtime, physical camera, real authentication provider, database confirmation or object storage exercised",
                results
            }, Json));

            async Task<OcrProposal> Upload(string image)
            {
                var info = new System.Diagnostics.ProcessStartInfo(Path.Combine(repository, ".tools/node-v22.23.4-win-x64/node.exe"))
                { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
                foreach (var argument in new[] { bundle, origin, resources.TaskId.ToString(), image }) info.ArgumentList.Add(argument);
                info.Environment["NODE_EXTRA_CA_CERTS"] = certificatePath;
                using var process = System.Diagnostics.Process.Start(info)!;
                var stdout = process.StandardOutput.ReadToEndAsync();
                var stderr = process.StandardError.ReadToEndAsync();
                try
                {
                    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                    await process.WaitForExitAsync(deadline.Token);
                    Assert.True(process.ExitCode == 0, await stderr);
                    return JsonSerializer.Deserialize<OcrProposal>(await stdout, Json)!;
                }
                finally { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            }

            string JpegUpload(string path)
            {
                using var image = Cv2.ImRead(path);
                var destination = Path.Combine(Root, "mobile_upload_" + Path.GetFileNameWithoutExtension(path) + ".jpg");
                File.WriteAllBytes(destination, image.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85)));
                return destination;
            }
        }
        finally { await bridge.StopAsync(); File.Delete(certificatePath); }
    }

    private sealed class Resources : IOcrWorkflowResources
    {
        public Guid TaskId { get; } = Guid.NewGuid();
        public Guid LocationId { get; } = Guid.NewGuid();
        public bool CanCapture { get; } = true;
        public OcrDocumentKind Kind { get; set; }
        public int Proposals { get; private set; }
        public OcrProposal? LastProposal { get; private set; }
        public Task<OcrWorkflowResource?> FindIdentityAsync(Guid id, CancellationToken token) => Task.FromResult<OcrWorkflowResource?>(null);
        public Task<OcrWorkflowResource?> FindMeterTaskAsync(Guid id, CancellationToken token) => Task.FromResult<OcrWorkflowResource?>(
            id == TaskId ? new(new(LocationId, null), CanCapture, Kind, 1) : null);
        public Task RecordMeterProposalAsync(Guid id, OcrProposal proposal, CancellationToken token)
        { Assert.Equal(TaskId, id); Proposals++; LastProposal = proposal; return Task.CompletedTask; }
    }

    private sealed class Assignments(Guid location) : IStaffLocationAccess
    {
        public bool Assigned { get; set; } = true;
        public Task<bool> IsAssignedAsync(Guid staff, Guid target, CancellationToken token) => Task.FromResult(Assigned && target == location);
    }
}

public sealed class MeterClassifierPilotFactAttribute : FactAttribute
{
    public MeterClassifierPilotFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_METER_CLASSIFIER_PILOT_ROOT")))
            Skip = "Set BHOME_METER_CLASSIFIER_PILOT_ROOT to the explicitly trained local pilot artifacts; tests never download or train implicitly.";
    }
}
