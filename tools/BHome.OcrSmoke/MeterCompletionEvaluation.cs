using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

internal static class MeterCompletionEvaluation
{
    public static async Task<int> RunAsync(string ocr, string yolo, string images, string report)
    {
        var options = new OcrOptions { Enabled = true, ModelDirectory = ocr, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digitEngine = new YoloWaterDigitRecognizer(options); digitEngine.Warmup(default);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digitEngine);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        using var baselineEngine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector);
        using var baseline = new LocalOcrService(options, new Lazy<IOcrEngine>(() => baselineEngine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>();
        foreach (var path in Directory.GetFiles(images, "*.jpg").Order())
        {
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expected = string.Concat(labels.Where(l => int.Parse(l[0]) is >= 2 and < 12)
                .OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], CultureInfo.InvariantCulture)))
                .Select(l => int.Parse(l[0]) - 2));
            var clear = !labels.Any(l => l[0] == "12");
            // Match the existing mobile capture contract: longest side <=1600,
            // JPEG quality85. Originals and labels remain untouched.
            using var original = Cv2.ImRead(path); using var resized = new Mat();
            var ratio = Math.Min(1, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, resized, new((int)(original.Width * ratio), (int)(original.Height * ratio)), 0, 0, InterpolationFlags.Area);
            var mobileBytes = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            using var baselineInput = new MemoryStream(mobileBytes); var baselineClock = Stopwatch.StartNew();
            var before = await baseline.ExtractAsync(baselineInput, OcrDocumentKind.MechanicalWater, default);
            var baselineMilliseconds = baselineClock.ElapsedMilliseconds;
            using var input = new MemoryStream(mobileBytes); var watch = Stopwatch.StartNew();
            var typed = await service.ExtractAsync(input, OcrDocumentKind.MechanicalWater, default);
            var elapsed = watch.ElapsedMilliseconds;
            using var automaticInput = new MemoryStream(mobileBytes); watch.Restart();
            var auto = await service.ExtractAutomaticAsync(automaticInput, default);
            var typedValue = typed.ProposedFields.GetValueOrDefault("reading");
            var autoValue = auto.MeterProposal?.ProposedFields.GetValueOrDefault("reading");
            var baselineValue = before.ProposedFields.GetValueOrDefault("reading");
            rows.Add(new { file = Path.GetFileName(path), clear, inputTransform = "mobile-1600-jpeg85",
                baselineProposed = baselineValue is not null, baselineExact = clear && baselineValue == expected,
                baselineFalse = clear && baselineValue is not null && baselineValue != expected, baselineMilliseconds,
                typedProposed = typedValue is not null, typedExact = clear && typedValue == expected, typedFalse = clear && typedValue is not null && typedValue != expected,
                typedWarnings = typed.Warnings, typedMilliseconds = elapsed,
                automaticProposed = autoValue is not null, automaticExact = clear && autoValue == expected, automaticFalse = clear && autoValue is not null && autoValue != expected,
                auto.ClassificationStatus, auto.DetectedCategory, auto.PartialCategory, cropAvailable = auto.CropPreviewDataUri is not null,
                automaticWarnings = auto.Warnings.Concat(auto.MeterProposal?.Warnings ?? []).Distinct().ToArray(), automaticMilliseconds = watch.ElapsedMilliseconds });
            Console.WriteLine($"Final pipeline evaluated {rows.Count} public images");
            Array.Clear(mobileBytes); resized.SetTo(Scalar.All(0));
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { rows,
            limitation = "Author analog-water test split; repeated meters and annotation gaps. No independent Vietnamese four-category acceptance set; decimal billing precision not labeled." }, OcrEvaluation.Json));
        return 0;
    }
}
