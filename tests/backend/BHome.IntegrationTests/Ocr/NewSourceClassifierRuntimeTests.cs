using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;

namespace BHome.IntegrationTests.Ocr;

public sealed class NewSourceClassifierRuntimeTests
{
    [NextStaffCandidateFact]
    public async Task NewSourceClassifierIsMeasuredWithoutThresholdRetuning()
    {
        var directory=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        using var manifest=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory,"docs/datasets/meter/next-staff-source-probes.json")));
        var observations=new List<object>();
        foreach(var (name,folder) in new[] {("baseline",".tools/ocr-runtime-focus/classifier-cv2"),("candidate",".tools/ocr-next-staff/fresh-source-heads")})
        {
            using var receipt=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory,folder,"report.json")));
            var config=new OcrOptions {ExperimentalMeter=new() {Enabled=true,ClassifierPath=Path.Combine(directory,folder,"classifier.onnx"),
                ClassifierSha256=receipt.RootElement.GetProperty("modelSha256").GetString()!,UtilityThreshold=.55f,TechnologyThreshold=.75f}};
            using var classifier=new ExperimentalVisualMeterClassifier(config,true);
            foreach(var sample in manifest.RootElement.GetProperty("samples").EnumerateArray())
            {
                var bytes=await File.ReadAllBytesAsync(Path.Combine(directory,sample.GetProperty("image").GetString()!));
                Assert.Equal(sample.GetProperty("sha256").GetString(),Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
                using var prepared=new ImagePreprocessor(config).PrepareUnclassified(bytes);
                var decision=classifier.Classify(prepared.Image,default);
                observations.Add(new {name,id=sample.GetProperty("id").GetString(),expected=sample.GetProperty("category").GetString(),
                    accepted=decision.Decision.Kind is {} kind?OcrCategories.Name(kind):"unknown",decision.Decision,guess=decision.Guess is {} guess?OcrCategories.Name(guess):null,
                    sha256=config.ExperimentalMeter.ClassifierSha256});
            }
        }
        Assert.Equal(8,observations.Count);
        await File.WriteAllTextAsync(Path.Combine(directory,".tools/ocr-next-staff/source-classifiers-dotnet.json"),JsonSerializer.Serialize(observations,new JsonSerializerOptions {WriteIndented=true}));
    }
}

public sealed class NextStaffCandidateFactAttribute : FactAttribute
{
    public NextStaffCandidateFactAttribute()
    {
        var root=Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT");
        if(string.IsNullOrWhiteSpace(root)||!File.Exists(Path.Combine(root,".tools/ocr-next-staff/fresh-source-heads/classifier.onnx")))
            Skip="Requires the frozen new-source candidate and licensed local probes.";
    }
}
