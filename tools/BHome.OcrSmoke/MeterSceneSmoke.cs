using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

// Deterministic adapter fixtures + real PP-OCR. This measures orchestration/cropping,
// never meter detection/classification accuracy. Use New-MeterSafetyFixtures.ps1.
internal static class MeterSceneSmoke
{
    public static async Task<int> RunAsync(string models, string fixtures)
    {
        var options = new OcrOptions { Enabled = true, ModelDirectory = models };
        var adapter = new FixtureDetector();
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), adapter);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        var passed = 0; var total = 0;
        foreach (var kind in Enum.GetValues<OcrDocumentKind>().Skip(2))
        {
            var display = new DetectedReadingRegion(new(20, 160, 550, 110), .99f);
            var meter = new DetectedMeter(new(0, 0, 1200, 600), .99f, kind, .99f, [display]);
            (string Name, MeterScene Scene, bool Fallback, string? Warning)[] cases = [
                ("display-crop", new(true, [meter]), false, null),
                ("no-meter", new(true, []), true, "meter_not_detected"),
                ("multiple-meters", new(true, [meter, meter]), true, "multiple_meters"),
                ("no-display", new(true, [meter with { ReadingRegions = [] }]), true, "reading_region_not_detected"),
                ("multiple-displays", new(true, [meter with { ReadingRegions = [display, display] }]), true, "ambiguous_reading"),
                ("low-confidence", new(true, [meter with { Confidence = .1f }]), true, "meter_detection_uncertain"),
                ("wrong-category", new(true, [meter with { Category = OcrDocumentKind.IdentityFront }]), true, "meter_type_mismatch"),
                ("unavailable-legacy", new(false, []), true, "ambiguous_reading")
            ];
            foreach (var sample in cases)
            {
                adapter.Scene = sample.Scene;
                using var input = File.OpenRead(Path.Combine(fixtures, $"{kind}-same-displays.png"));
                var clock = Stopwatch.StartNew();
                var result = await service.ExtractAsync(input, kind, default);
                var success = result.IsFallback == sample.Fallback &&
                    (sample.Fallback ? result.ProposedFields.Count == 0 : result.ProposedFields.GetValueOrDefault("reading") == "00123.45") &&
                    (sample.Warning is null || result.Warnings.Contains(sample.Warning)) && result.RequiresConfirmation;
                total++; if (success) passed++;
                Console.WriteLine(JsonSerializer.Serialize(new { scenario = sample.Name, profile = kind.ToString(), passed = success, elapsedMilliseconds = clock.ElapsedMilliseconds }));
            }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { stage = "fixture-localization-with-real-ocr", total, passed }));
        return total == passed ? 0 : 1;
    }

    private sealed class FixtureDetector : IMeterSceneDetector
    {
        public MeterScene Scene { get; set; } = new(false, []);
        public MeterScene Detect(Mat image, CancellationToken token) { token.ThrowIfCancellationRequested(); return Scene; }
    }
}
