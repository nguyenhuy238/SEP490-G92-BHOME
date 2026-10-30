using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.ML.OnnxRuntime;

var generation = args.Length == 3 && args[0] == "--generate-evaluation";
var evaluation = args.Length is 3 or 4 && args[1] == "--evaluate";
var smoke = args.Length == 2 && args[0] != "--generate-evaluation" && args[1] != "--evaluate";
if (!generation && !evaluation && !smoke)
{ Console.Error.WriteLine("Usage: BHome.OcrSmoke <model-directory> <synthetic-fixture-directory> | <model-directory> --evaluate <manifest.json> [report.json] | --generate-evaluation <synthetic-fixture-directory> <output-directory>"); return 2; }
if (generation)
{
    SyntheticEvaluation.Generate(args[1], args[2]);
    return 0;
}
var options = new OcrOptions { Enabled = true, ModelDirectory = args[0] };
var clock = Stopwatch.StartNew();
using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
Console.WriteLine(JsonSerializer.Serialize(new
{
    stage = "initialization",
    elapsedMs = clock.ElapsedMilliseconds,
    os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
    cpuCount = Environment.ProcessorCount
}));
foreach (var name in new[] { "detection.onnx", "recognition.onnx" })
{
    using var metadataSession = new InferenceSession(Path.Combine(args[0], name));
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        model = name,
        inputs = metadataSession.InputMetadata.ToDictionary(x => x.Key, x => x.Value.Dimensions),
        outputs = metadataSession.OutputMetadata.ToDictionary(x => x.Key, x => x.Value.Dimensions)
    }));
}
using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
if (evaluation)
{
    try { return await OcrEvaluation.RunAsync(service, args[2], args.Length == 4 ? args[3] : null); }
    catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or OcrInputException)
    { Console.Error.WriteLine("Evaluation input invalid or unavailable. No image/text/value/path is logged."); return 2; }
}
var cases = new SmokeCase[]
{
    new("identity-front.png", OcrDocumentKind.IdentityFront, "fullName", "NGƯỜI KIỂM THỬ"),
    new("identity-back.png", OcrDocumentKind.IdentityBack, "dateOfIssue", "2020-01-01"),
    new("meter.png", OcrDocumentKind.MechanicalElectricity, "reading", "00123.45"),
    new("meter.png", OcrDocumentKind.MechanicalWater, "reading", "00123.45"),
    new("meter.png", OcrDocumentKind.DigitalElectricity, "reading", "00123.45"),
    new("meter.png", OcrDocumentKind.DigitalWater, "reading", "00123.45"),
    new("identity-back-layout.png", OcrDocumentKind.IdentityBack, "dateOfIssue", "2020-02-01"),
    new("identity-back-2024.png", OcrDocumentKind.IdentityBack, "dateOfIssue", "2024-07-01"),
    new("electricity-mechanical.png", OcrDocumentKind.MechanicalElectricity, "reading", "00123.45"),
    new("electricity-digital.png", OcrDocumentKind.DigitalElectricity, "reading", "00123.45"),
    new("water-mechanical.png", OcrDocumentKind.MechanicalWater, "reading", "00123.45"),
    new("water-digital.png", OcrDocumentKind.DigitalWater, "reading", "00123.45"),
    new("identity-front-layout.png", OcrDocumentKind.IdentityFront, "fullName", "NGƯỜI KIỂM THỬ"),
    new("identity-back-residence.png", OcrDocumentKind.IdentityBack, "residentialAddress", "THÔN GIẢ LẬP XÃ KIỂM THỬ, TỈNH MÔ PHỎNG"),
    new("electricity-mechanical-wheels.png", OcrDocumentKind.MechanicalElectricity, "reading", "00456.78", 2),
    new("water-mechanical-wheels.png", OcrDocumentKind.MechanicalWater, "reading", "00987.654", 3),
    new("electricity-digital-lcd.png", OcrDocumentKind.DigitalElectricity, "reading", "073219.4", 1),
    new("water-digital-lcd.png", OcrDocumentKind.DigitalWater, "reading", "000432.1", 1)
};
var success = true;
foreach (var sample in cases)
{
    using var input = File.OpenRead(Path.Combine(args[1], sample.File));
    var process = Process.GetCurrentProcess();
    var cpu = process.TotalProcessorTime;
    clock.Restart();
    var result = await service.ExtractAsync(input, sample.Kind, default);
    if (sample.Kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
        result = MeterReadingPrecision.Apply(result, sample.DecimalPlaces);
    var passed = !result.IsFallback && result.ProposedFields.GetValueOrDefault(sample.Key) == sample.Value;
    success &= passed;
    process.Refresh();
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        profile = sample.Kind.ToString(),
        fixture = sample.File,
        passed,
        elapsedMs = clock.ElapsedMilliseconds,
        cpuMs = (process.TotalProcessorTime - cpu).TotalMilliseconds,
        workingSetBytes = process.WorkingSet64,
        peakWorkingSetBytes = process.PeakWorkingSet64,
        fields = result.ProposedFields.Keys,
        warnings = result.Warnings,
        requiresConfirmation = result.RequiresConfirmation
    }));
}
return success ? 0 : 1;

internal sealed record SmokeCase(string File, OcrDocumentKind Kind, string Key, string Value, int? DecimalPlaces = null);
