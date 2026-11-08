using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;

namespace BHome.IntegrationTests.Ocr;

public sealed class NewSourceClassifierRuntimeTests
{
    [ActivationTechnologyModelFact]
    public async Task AdditionalLcdTechnologyHeadMatchesRealOnnxReferencesWithoutBypassingInputValidation()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "docs/datasets/meter/activation-next-source-probes.json")));
        using var reference = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, ".tools/ocr-activation-next/lcd-tech-heads/runtime-reference.json")));
        var rows = new List<object>();
        foreach (var (mode, folder) in new[] { ("baseline", ".tools/ocr-runtime-focus/classifier-cv2"), ("candidate", ".tools/ocr-activation-next/lcd-tech-heads") })
        {
            using var receipt = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, folder, "report.json")));
            var config = new OcrOptions
            {
                ExperimentalMeter = new()
                {
                    Enabled = true,
                    ClassifierPath = Path.Combine(directory, folder, "classifier.onnx"),
                    ClassifierSha256 = receipt.RootElement.GetProperty("modelSha256").GetString()!,
                    UtilityThreshold = .55f,
                    TechnologyThreshold = .75f
                }
            };
            using var classifier = new ExperimentalVisualMeterClassifier(config, true);
            foreach (var sample in manifest.RootElement.GetProperty("samples").EnumerateArray())
            {
                var id = sample.GetProperty("id").GetString();
                var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, sample.GetProperty("image").GetString()!));
                Assert.Equal(sample.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
                if (id == "quanhui_water_09")
                {
                    Assert.Throws<OcrInputException>(() => new ImagePreprocessor(config).PrepareUnclassified(bytes));
                    rows.Add(new { mode, id, inputRejected = true }); continue;
                }
                using var prepared = new ImagePreprocessor(config).PrepareUnclassified(bytes);
                var result = classifier.Classify(prepared.Image, default);
                var accepted = result.Decision.Kind is { } kind ? OcrCategories.Name(kind) : "unknown";
                var expected = reference.RootElement.EnumerateArray().Single(r => r.GetProperty("mode").GetString() == mode && r.GetProperty("id").GetString() == id);
                Assert.Equal(expected.GetProperty("accepted").GetString(), accepted);
                Assert.NotEqual("unavailable", result.Decision.Status);
                rows.Add(new { mode, id, inputRejected = false, accepted, result.Decision });
            }
        }
        Assert.Equal(34, rows.Count);
        await File.WriteAllTextAsync(Path.Combine(directory, ".tools/ocr-activation-next/classifier-dotnet.json"), JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
    }
    [NextStaffCandidateFact]
    public async Task NewSourceClassifierIsMeasuredWithoutThresholdRetuning()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "docs/datasets/meter/next-staff-source-probes.json")));
        var observations = new List<object>();
        foreach (var (name, folder) in new[] { ("baseline", ".tools/ocr-runtime-focus/classifier-cv2"), ("candidate", ".tools/ocr-next-staff/fresh-source-heads") })
        {
            using var receipt = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, folder, "report.json")));
            var config = new OcrOptions
            {
                ExperimentalMeter = new()
                {
                    Enabled = true,
                    ClassifierPath = Path.Combine(directory, folder, "classifier.onnx"),
                    ClassifierSha256 = receipt.RootElement.GetProperty("modelSha256").GetString()!,
                    UtilityThreshold = .55f,
                    TechnologyThreshold = .75f
                }
            };
            using var classifier = new ExperimentalVisualMeterClassifier(config, true);
            foreach (var sample in manifest.RootElement.GetProperty("samples").EnumerateArray())
            {
                var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, sample.GetProperty("image").GetString()!));
                Assert.Equal(sample.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
                using var prepared = new ImagePreprocessor(config).PrepareUnclassified(bytes);
                var decision = classifier.Classify(prepared.Image, default);
                observations.Add(new
                {
                    name,
                    id = sample.GetProperty("id").GetString(),
                    expected = sample.GetProperty("category").GetString(),
                    accepted = decision.Decision.Kind is { } kind ? OcrCategories.Name(kind) : "unknown",
                    decision.Decision,
                    guess = decision.Guess is { } guess ? OcrCategories.Name(guess) : null,
                    sha256 = config.ExperimentalMeter.ClassifierSha256
                });
            }
        }
        Assert.Equal(8, observations.Count);
        await File.WriteAllTextAsync(Path.Combine(directory, ".tools/ocr-next-staff/source-classifiers-dotnet.json"), JsonSerializer.Serialize(observations, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class ActivationTechnologyModelFactAttribute : FactAttribute
{
    public ActivationTechnologyModelFactAttribute()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT");
        if (string.IsNullOrWhiteSpace(root) || !File.Exists(Path.Combine(root, ".tools/ocr-activation-next/lcd-tech-heads/classifier.onnx")))
            Skip = "Requires the licensed offline technology experiment and frozen public probes.";
    }
}

public sealed class NextStaffCandidateFactAttribute : FactAttribute
{
    public NextStaffCandidateFactAttribute()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT");
        if (string.IsNullOrWhiteSpace(root) || !File.Exists(Path.Combine(root, ".tools/ocr-next-staff/fresh-source-heads/classifier.onnx")))
            Skip = "Requires the frozen new-source candidate and licensed local probes.";
    }
}
