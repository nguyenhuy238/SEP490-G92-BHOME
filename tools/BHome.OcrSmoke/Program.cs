using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.ML.OnnxRuntime;

if (args.Length != 2) { Console.Error.WriteLine("Usage: BHome.OcrSmoke <model-directory> <synthetic-fixture-directory>"); return 2; }
var options = new OcrOptions { Enabled = true, ModelDirectory = args[0] };
var clock = Stopwatch.StartNew();
using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
Console.WriteLine(JsonSerializer.Serialize(new { stage = "initialization", elapsedMs = clock.ElapsedMilliseconds,
    os = System.Runtime.InteropServices.RuntimeInformation.OSDescription, cpuCount = Environment.ProcessorCount }));
foreach (var name in new[] { "detection.onnx", "recognition.onnx" })
{
    using var metadataSession = new InferenceSession(Path.Combine(args[0], name));
    Console.WriteLine(JsonSerializer.Serialize(new { model = name,
        inputs = metadataSession.InputMetadata.ToDictionary(x => x.Key, x => x.Value.Dimensions),
        outputs = metadataSession.OutputMetadata.ToDictionary(x => x.Key, x => x.Value.Dimensions) }));
}
using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
var cases = new[]
{
    (File: "identity-front.png", Kind: OcrDocumentKind.IdentityFront, Key: "fullName", Value: "NGƯỜI KIỂM THỬ"),
    (File: "identity-back.png", Kind: OcrDocumentKind.IdentityBack, Key: "dateOfIssue", Value: "2020-01-01"),
    (File: "meter.png", Kind: OcrDocumentKind.MechanicalElectricity, Key: "reading", Value: "00123.45"),
    (File: "meter.png", Kind: OcrDocumentKind.MechanicalWater, Key: "reading", Value: "00123.45"),
    (File: "meter.png", Kind: OcrDocumentKind.DigitalElectricity, Key: "reading", Value: "00123.45"),
    (File: "meter.png", Kind: OcrDocumentKind.DigitalWater, Key: "reading", Value: "00123.45")
};
var success = true;
foreach (var sample in cases)
{
    using var input = File.OpenRead(Path.Combine(args[1], sample.File));
    var process = Process.GetCurrentProcess();
    var cpu = process.TotalProcessorTime;
    clock.Restart();
    var result = await service.ExtractAsync(input, sample.Kind, default);
    var passed = !result.IsFallback && result.ProposedFields.GetValueOrDefault(sample.Key) == sample.Value;
    success &= passed;
    process.Refresh();
    Console.WriteLine(JsonSerializer.Serialize(new { profile = sample.Kind.ToString(), passed,
        elapsedMs = clock.ElapsedMilliseconds, cpuMs = (process.TotalProcessorTime - cpu).TotalMilliseconds,
        workingSetBytes = process.WorkingSet64, peakWorkingSetBytes = process.PeakWorkingSet64,
        fields = result.ProposedFields.Keys, warnings = result.Warnings,
        requiresConfirmation = result.RequiresConfirmation }));
}
return success ? 0 : 1;
