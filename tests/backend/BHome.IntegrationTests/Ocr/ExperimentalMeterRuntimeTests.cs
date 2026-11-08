using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Ocr;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.ML.OnnxRuntime;

namespace BHome.IntegrationTests.Ocr;

public sealed class ExperimentalMeterRuntimeTests
{
    [ExperimentalModelsFact]
    public async Task UnitRefinementRecoversConsumptionWithoutAcceptingInvalidFullFrames()
    {
        var directory=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var manifest=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory,"docs/datasets/meter/runtime-diagnostic-evaluation.json")));
        var samples=manifest.RootElement.GetProperty("samples").EnumerateArray().Select(s=>s.Clone()).ToArray();
        var observations=samples.ToDictionary(s=>s.GetProperty("id").GetString()!,_=>new Dictionary<string,JsonElement>());
        foreach(var (mode,enabled) in new[] { ("baseline",false),("candidate",true) })
        {
            using var root=new ApiFactory();using var factory=Configure(root,directory,refineUnits:enabled);using var client=factory.CreateClient();
            foreach(var sample in samples)
            {
                var bytes=await File.ReadAllBytesAsync(Path.Combine(directory,sample.GetProperty("image").GetString()!));
                Assert.Equal(sample.GetProperty("sha256").GetString(),Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
                using var request=Request("?experimental=true",Roles.Staff,bytes);
                using var response=await client.SendAsync(request);Assert.Equal(HttpStatusCode.OK,response.StatusCode);
                using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                var id=sample.GetProperty("id").GetString()!;observations[id][mode]=document.RootElement.Clone();
                var analysis=document.RootElement.GetProperty("analysis");
                Assert.True(analysis.GetProperty("experimental").GetBoolean());Assert.False(analysis.GetProperty("businessProposalEnabled").GetBoolean());
                Assert.False(analysis.TryGetProperty("meterProposal",out _));
                var digits=analysis.GetProperty("readingCandidate").GetString();
                if(digits is not null) Assert.Equal(sample.GetProperty("expectedDigits").GetString(),digits);
                if(sample.GetProperty("expectedDigits").ValueKind==JsonValueKind.Null) Assert.Null(digits);
                if(id=="commons_136480278") Assert.Equal("74590",digits);
            }
        }
        Assert.Null(observations["commons_54903199"]["baseline"].GetProperty("analysis").GetProperty("readingCandidate").GetString());
        Assert.Equal("000501",observations["commons_54903199"]["candidate"].GetProperty("analysis").GetProperty("readingCandidate").GetString());
        Assert.Null(observations["commons_105770219"]["candidate"].GetProperty("analysis").GetProperty("readingCandidate").GetString());
        await File.WriteAllTextAsync(Path.Combine(directory,".tools/ocr-staff-focus/http-before-after.json"),
            JsonSerializer.Serialize(samples.Select(s=>new { sample=s,results=observations[s.GetProperty("id").GetString()!] }),new JsonSerializerOptions { WriteIndented=true }));
    }

    [ExperimentalModelsFact]
    public async Task NativePreprocessingAndRealOnnxLogitsMatchPythonReferences()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var parityDirectory = Path.Combine(directory, ".tools/ocr-runtime-focus/parity");
        using var references = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(parityDirectory, "references.json")));
        var modelPath = Path.Combine(directory, ".tools/ocr-runtime-focus/classifier-cv2/classifier.onnx");
        Assert.Equal(references.RootElement.GetProperty("modelSha256").GetString(),
            Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(modelPath))).ToLowerInvariant());
        using var settings = new SessionOptions { IntraOpNumThreads = 2, InterOpNumThreads = 1 };
        using var model = new InferenceSession(modelPath, settings);
        var observations = new List<object>();
        var preprocessor = new ImagePreprocessor(new OcrOptions());
        foreach (var sample in references.RootElement.GetProperty("samples").EnumerateArray())
        {
            var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, sample.GetProperty("image").GetString()!));
            Assert.Equal(sample.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
            using var prepared = preprocessor.PrepareUnclassified(bytes);
            var tensor = ExperimentalVisualMeterClassifier.Pixels(prepared.Image);
            var referenceBytes = await File.ReadAllBytesAsync(Path.Combine(parityDirectory, sample.GetProperty("tensor").GetString()!));
            var reference = new float[referenceBytes.Length / sizeof(float)];
            Buffer.BlockCopy(referenceBytes, 0, reference, 0, referenceBytes.Length);
            Assert.Equal(reference.Length, tensor.Length);
            var pixelDelta = tensor.ToArray().Zip(reference, (a,b) => Math.Abs(a-b)).Max();
            Assert.True(pixelDelta <= 1e-5, $"Preprocessing delta {pixelDelta}");
            using var output = model.Run([NamedOnnxValue.CreateFromTensor("pixel_values", tensor)]);
            var maxLogitDelta = 0f;
            foreach (var (name,index) in new[] { ("utility_logits",0), ("technology_logits",1) })
            {
                var expected = sample.GetProperty("logits")[index].EnumerateArray().Select(x => x.GetSingle()).ToArray();
                var actual = output.First(x => x.Name == name).AsTensor<float>().ToArray();
                maxLogitDelta = Math.Max(maxLogitDelta, actual.Zip(expected, (a,b) => Math.Abs(a-b)).Max());
                Assert.Equal(Array.IndexOf(expected, expected.Max()), Array.IndexOf(actual, actual.Max()));
            }
            Assert.True(maxLogitDelta <= 1e-3, $"ONNX logit delta {maxLogitDelta}");
            observations.Add(new { id = sample.GetProperty("id").GetString(), pixelDelta, maxLogitDelta });
            tensor.Buffer.Span.Clear();
        }
        Assert.Equal(9, observations.Count);
        await File.WriteAllTextAsync(Path.Combine(parityDirectory, "dotnet-results.json"),
            JsonSerializer.Serialize(observations, new JsonSerializerOptions { WriteIndented = true }));
    }

    [ExperimentalModelsFact]
    public async Task SameFrozenFullFramesAreMeasuredThroughBothAspNetRoutes()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "docs/datasets/meter/runtime-diagnostic-evaluation.json")));
        using var root = new ApiFactory(); using var factory = Configure(root, directory); using var client = factory.CreateClient();
        var observations = new List<object>();
        foreach (var sample in manifest.RootElement.GetProperty("samples").EnumerateArray())
        {
            var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, sample.GetProperty("image").GetString()!));
            Assert.Equal(sample.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
            var results = new Dictionary<string,JsonElement>();
            foreach (var (mode, query) in new[] { ("baseline", ""), ("candidate", "?experimental=true") })
            {
                using var request = Request(query, Roles.Staff, bytes);
                using var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                results[mode] = document.RootElement.Clone();
            }
            observations.Add(new { sample = sample.Clone(), results });
            var candidate = results["candidate"].GetProperty("analysis");
            Assert.False(candidate.GetProperty("businessProposalEnabled").GetBoolean());
            Assert.False(candidate.TryGetProperty("meterProposal", out _));
            var id = sample.GetProperty("id").GetString();
            if (id == "commons_136480278") Assert.Equal("74590", candidate.GetProperty("readingCandidate").GetString());
            if (id == "commons_151445788") Assert.Null(candidate.GetProperty("readingCandidate").GetString());
            Assert.False(results["baseline"].GetProperty("analysis").TryGetProperty("experimental", out _));
        }
        Assert.Equal(13, observations.Count);
        await File.WriteAllTextAsync(Path.Combine(directory, ".tools/ocr-runtime-focus/http-before-after.json"),
            JsonSerializer.Serialize(observations, new JsonSerializerOptions { WriteIndented = true }));
    }

    [ExperimentalModelsFact]
    public async Task AmbiguousAndMalformedOptInAreRejectedBeforeInference()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var root = new ApiFactory(); using var factory = Configure(root, directory); using var client = factory.CreateClient();
        foreach (var query in new[] { "?experimental=true&experimental=false", "?experimental=perhaps",
            "?taskId=00000000-0000-0000-0000-000000000001",
            "?experimental=true&taskId=invalid",
            "?experimental=true&taskId=00000000-0000-0000-0000-000000000001&taskId=00000000-0000-0000-0000-000000000002" })
        {
            using var request = Request(query, Roles.Owner, []);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(request)).StatusCode);
        }
    }
    private static WebApplicationFactory<Program> Configure(ApiFactory root, string directory,
        string environment = "Development", bool mobile = true, bool experimental = true, string? modelPath = null, string? hash = null,
        bool refineUnits = true)
    {
        var receiptPath=Path.Combine(directory,".tools/ocr-runtime-focus/classifier-cv2/report.json");
        var sha=hash ?? (File.Exists(receiptPath)?JsonDocument.Parse(File.ReadAllText(receiptPath)).RootElement.GetProperty("modelSha256").GetString():new string('0',64));
        return root.WithWebHostBuilder(builder=>builder.UseEnvironment(environment)
            .ConfigureAppConfiguration((_,config)=>config.AddInMemoryCollection(new Dictionary<string,string?>
            {
                ["MobileDevelopment:Enabled"]=mobile.ToString(),["Ocr:Enabled"]=(environment=="Development" && mobile && experimental).ToString(),
                ["Ocr:ModelDirectory"]=Path.Combine(directory,".tools/ocr-models"),["Ocr:TimeoutMilliseconds"]="9000",
                ["Ocr:ExperimentalMeter:Enabled"]=experimental.ToString(),
                ["Ocr:ExperimentalMeter:ClassifierPath"]=modelPath ?? Path.Combine(directory,".tools/ocr-runtime-focus/classifier-cv2/classifier.onnx"),
                ["Ocr:ExperimentalMeter:ClassifierSha256"]=sha,
                ["Ocr:ExperimentalMeter:EnglishModelDirectory"]=Path.Combine(directory,".tools/ocr-recovery-english"),
                ["Ocr:ExperimentalMeter:UtilityThreshold"]="0.55",["Ocr:ExperimentalMeter:TechnologyThreshold"]="0.75",
                ["Ocr:ExperimentalMeter:RefineUnitCrops"]=refineUnits.ToString(),
                ["Ocr:ExperimentalMeter:Categories:0"]="DigitalElectricity"
            })).ConfigureTestServices(OcrApiTests.AddTestAuthentication));
    }

    private static HttpRequestMessage Request(string route, string? role, byte[] image)
    {
        var request=new HttpRequestMessage(HttpMethod.Post,"/api/v1/ocr/diagnostics/auto"+route) { Content=new ByteArrayContent(image) };
        request.Content.Headers.ContentType=new MediaTypeHeaderValue("image/jpeg");
        if(role is not null) request.Headers.Add("X-Test-Role",role);
        return request;
    }

    [ExperimentalModelsFact]
    public async Task RealOnnxRunsThroughAspNetDiagnosticsForPositiveInvalidAndUnknownImages()
    {
        var directory=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var observations=new List<object>();
        using var root=new ApiFactory();using var factory=Configure(root,directory);using var client=factory.CreateClient();
        Assert.IsType<OnnxOcrEngine>(factory.Services.GetRequiredService<IOcrEngine>());
        var cases=new[] {
            ("positive",".tools/ocr-continued/commons_54903199.jpg"),
            ("positive_without_verified_unit",".tools/master-dataset/commons/commons_105770219.jpg"),
            ("non_consumption",".tools/master-dataset/commons/commons_151445788.jpg"),
            ("uncertain_category",".tools/master-dataset/commons/commons_51969773.jpg")
            ,("historical_positive_74590",".tools/master-dataset/commons/commons_136480278.jpg")
            ,("historical_positive_004046",".tools/master-dataset/commons/commons_141575682.jpg")
            ,("historical_positive_21594",".tools/master-dataset/commons/commons_26507235.jpg")
            ,("historical_inactive",".tools/master-dataset/commons/commons_111639614.jpg")
        };
        var actual=new Dictionary<string,JsonElement>();
        foreach(var (name,path) in cases)
        {
            var source=Path.Combine(directory,path);
            // The lid fixture was acquired in the expanded collection.
            if(!File.Exists(source) && name=="uncertain_category") source=Path.Combine(directory,".tools/ocr-next-public-images-expanded/commons_51969773.jpg");
            using var request=Request("?experimental=true",Roles.Staff,await File.ReadAllBytesAsync(source));
            var response=await client.SendAsync(request);Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync());var analysis=document.RootElement.GetProperty("analysis").Clone();
            Assert.True(analysis.GetProperty("experimental").GetBoolean());Assert.False(analysis.GetProperty("businessProposalEnabled").GetBoolean());
            Assert.True(analysis.GetProperty("requiresConfirmation").GetBoolean());Assert.False(analysis.TryGetProperty("proposedFields",out _));
            Assert.False(analysis.TryGetProperty("meterProposal",out _));Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            actual[name]=analysis;observations.Add(new { name,analysis,elapsedMilliseconds=document.RootElement.GetProperty("elapsedMilliseconds").GetInt64() });
        }
        await File.WriteAllTextAsync(Path.Combine(directory,".tools/ocr-runtime-focus/http-runtime-results.json"),JsonSerializer.Serialize(observations,new JsonSerializerOptions { WriteIndented=true }));
        Assert.Equal("74590",actual["historical_positive_74590"].GetProperty("readingCandidate").GetString());
        Assert.Equal("000501",actual["positive"].GetProperty("readingCandidate").GetString());
        Assert.Null(actual["historical_inactive"].GetProperty("readingCandidate").GetString());
        Assert.Null(actual["non_consumption"].GetProperty("readingCandidate").GetString());
        Assert.Equal("unknown",actual["uncertain_category"].GetProperty("classification").GetProperty("status").GetString());
        Assert.Null(actual["uncertain_category"].GetProperty("readingCandidate").GetString());
    }

    [ExperimentalModelsFact]
    public async Task MissingAndIntegrityMismatchedModelsReturnExplicitFallback()
    {
        var directory=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        foreach(var missing in new[] {true,false})
        {
            using var root=new ApiFactory();using var factory=Configure(root,directory,
                modelPath:missing?Path.Combine(directory,".tools/ocr-runtime-focus/missing.onnx"):null,hash:new string('0',64));
            using var client=factory.CreateClient();using var request=Request("?experimental=true",Roles.Owner,
                await File.ReadAllBytesAsync(Path.Combine(directory,".tools/ocr-continued/commons_54903199.jpg")));
            var response=await client.SendAsync(request);Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync());var analysis=document.RootElement.GetProperty("analysis");
            Assert.Equal("unavailable",analysis.GetProperty("status").GetString());Assert.Null(analysis.GetProperty("readingCandidate").GetString());
            Assert.False(analysis.GetProperty("businessProposalEnabled").GetBoolean());
        }
    }

    [Theory]
    [InlineData("Production",true,true,HttpStatusCode.NotFound)]
    [InlineData("Development",false,true,HttpStatusCode.NotFound)]
    [InlineData("Development",true,false,HttpStatusCode.NotFound)]
    public async Task ExperimentalRouteNeedsAllDevelopmentFlags(string environment,bool mobile,bool experimental,HttpStatusCode expected)
    {
        using var root=new ApiFactory();using var factory=Configure(root,Path.GetTempPath(),environment,mobile,experimental);
        using var client=factory.CreateClient();using var request=Request("?experimental=true",Roles.Owner,[]);
        Assert.Equal(expected,(await client.SendAsync(request)).StatusCode);
    }

    [Theory]
    [InlineData(null,HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Tenant,HttpStatusCode.Forbidden)]
    public async Task ExperimentalRoutePreservesRoleAuthorization(string? role,HttpStatusCode expected)
    {
        using var root=new ApiFactory();using var factory=Configure(root,Path.GetTempPath(),experimental:false);
        using var client=factory.CreateClient();using var request=Request("?experimental=true",role,[]);
        Assert.Equal(expected,(await client.SendAsync(request)).StatusCode);
    }
}

public sealed class ExperimentalModelsFactAttribute : FactAttribute
{
    public ExperimentalModelsFactAttribute()
    {
        var root=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT");
        if(string.IsNullOrWhiteSpace(root) || !File.Exists(Path.Combine(root,".tools/ocr-runtime-focus/classifier-cv2/classifier.onnx")))
            Skip="Requires the locally trained, hash-verified experimental ONNX model and public fixtures.";
    }
}
