using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.ML.OnnxRuntime;

if (args.Length == 5 && args[0] == "--pretrained-yolo-evaluate")
    return await PretrainedYoloEvaluation.RunAsync(args[1], args[2], args[3], args[4]);
if (args.Length == 5 && args[0] == "--meter-recognition-compare")
    return await MeterRecognitionComparison.RunAsync(args[1], args[2], args[3], args[4]);
if (args.Length == 5 && args[0] == "--meter-completion-evaluate")
    return await MeterCompletionEvaluation.RunAsync(args[1], args[2], args[3], args[4]);
if (args.Length == 4 && args[0] == "--stage2-parity")
    return Stage2Parity.Run(args[1], args[2], args[3]);
if (args.Length == 5 && args[0] == "--digit-crop-probe")
    return DigitCropProbe.Run(args[1], args[2], args[3], args[4]);
if (args.Length == 6 && args[0] == "--pretrained-yolo-challenges")
    return await PretrainedYoloChallenges.RunAsync(args[1], args[2], args[3], args[4], args[5]);
if (args.Length == 4 && args[0] == "--auto-evaluate")
{
    var autoOptions = new OcrOptions { Enabled = true, ModelDirectory = args[1] };
    using var autoEngine = new OnnxOcrEngine(autoOptions, new ImagePreprocessor(autoOptions));
    using var autoService = new LocalOcrService(autoOptions, new Lazy<IOcrEngine>(() => autoEngine), NullLogger<LocalOcrService>.Instance);
    return await AutomaticOcrEvaluation.RunAsync(autoService, args[2], args[3]);
}
if (args.Length == 3 && args[0] == "--meter-scene-smoke")
    return await MeterSceneSmoke.RunAsync(args[1], args[2]);
var generation = args.Length == 3 && args[0] == "--generate-evaluation";
var evaluation = args.Length is 3 or 4 && args[1] == "--evaluate";
var smoke = args.Length == 2 && args[0] != "--generate-evaluation" && args[1] != "--evaluate";
if (!generation && !evaluation && !smoke)
{ Console.Error.WriteLine("Usage: BHome.OcrSmoke <model-directory> <synthetic-fixture-directory> | <model-directory> --evaluate <manifest.json> [report.json] | --generate-evaluation <synthetic-fixture-directory> <output-directory> | --meter-scene-smoke <model-directory> <meter-safety-fixture-directory> | --auto-evaluate <model-directory> <manifest.json> <report.json> | --pretrained-yolo-evaluate <ocr-models> <yolo-models> <public-images> <report.json> | --meter-recognition-compare <ocr-models> <yolo-models> <public-images> <output-dir> | --meter-completion-evaluate <ocr-models> <yolo-models> <public-images> <report.json> | --stage2-parity <yolo-models> <crop-dir> <report.json> | --digit-crop-probe <ocr-models> <yolo-models> <crop-dir> <report.json> | --pretrained-yolo-challenges <ocr-models> <yolo-models> <public-water.jpg> <synthetic-images> <report.json>"); return 2; }
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
