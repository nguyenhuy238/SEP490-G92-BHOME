using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

internal static class PretrainedYoloChallenges
{
    public static async Task<int> RunAsync(string ocrModels, string yoloModels, string waterImage, string syntheticImages, string report)
    {
        var options = new OcrOptions { Enabled = true, ModelDirectory = ocrModels, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, ModelDirectory = yoloModels } };
        using var detector = new YoloMeterSceneDetector(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        using var source = Cv2.ImRead(waterImage);
        using var resized = new Mat(); var ratio = 700d / Math.Max(source.Width, source.Height);
        Cv2.Resize(source, resized, new((int)(source.Width * ratio), (int)(source.Height * ratio)));
        using var twins = new Mat(resized.Height, resized.Width * 2, MatType.CV_8UC3, Scalar.White);
        using (var first = new Mat(twins, new Rect(0, 0, resized.Width, resized.Height))) resized.CopyTo(first);
        using (var second = new Mat(twins, new Rect(resized.Width, 0, resized.Width, resized.Height))) resized.CopyTo(second);
        using var angled = new Mat(); Cv2.Rotate(resized, angled, RotateFlags.Rotate90Clockwise);
        using var blur = new Mat(); Cv2.GaussianBlur(resized, blur, new(61, 61), 25);
        using var partial = new Mat(resized, new Rect(resized.Width / 2, 0, resized.Width / 2, resized.Height)).Clone();
        using var unknown = new Mat(400, 600, MatType.CV_8UC3, new Scalar(80, 40, 10));
        Cv2.Circle(unknown, new(200, 200), 50, Scalar.White, -1);
        var cases = new List<(string Name, byte[] Bytes)>
        {
            ("public-water-two-meters", twins.ImEncode(".png")),
            ("public-water-90-degrees", angled.ImEncode(".png")),
            ("public-water-heavy-blur", blur.ImEncode(".png")),
            ("public-water-half-cropped", partial.ImEncode(".png")),
            ("synthetic-unrelated-object", unknown.ImEncode(".png"))
        };
        foreach (var name in new[] { "front-0", "front-90", "front-180", "front-270", "back-0", "back-90", "back-180", "back-270", "electricity-0", "water-0", "blank-0", "mixed-sides-0" })
            cases.Add(("synthetic-" + name, await File.ReadAllBytesAsync(Path.Combine(syntheticImages, name + ".png"))));
        var rows = new List<object>(); var safe = true;
        foreach (var sample in cases)
        {
            using var stream = new MemoryStream(sample.Bytes); var clock = Stopwatch.StartNew();
            var result = await service.ExtractAutomaticAsync(stream, default);
            var reading = result.MeterProposal?.ProposedFields.ContainsKey("reading") == true;
            if (sample.Name is "public-water-two-meters" or "synthetic-unrelated-object" or "synthetic-blank-0")
                safe &= !reading && result.DetectedCategory == "unknown";
            if (sample.Name.StartsWith("synthetic-front-", StringComparison.Ordinal))
                safe &= result.IdentityProposal is not null && !reading && result.DetectedCategory == "cccd_front";
            if (sample.Name.StartsWith("synthetic-back-", StringComparison.Ordinal))
                safe &= result.IdentityProposal is not null && !reading && result.DetectedCategory == "cccd_back";
            if (sample.Name == "synthetic-mixed-sides-0") safe &= result.IdentityProposal is null && !reading;
            rows.Add(new { sample.Name, result.ClassificationStatus, result.DetectedCategory, result.PartialCategory,
                readingProposed = reading, cropAvailable = result.CropPreviewDataUri is not null,
                warnings = result.Warnings.Concat(result.MeterProposal?.Warnings ?? []).Distinct().ToArray(), elapsedMilliseconds = clock.ElapsedMilliseconds });
            Array.Clear(sample.Bytes);
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { safetyAssertionsPassed = safe, rows,
            limitation = "Derived public water image and synthetic cards/unit labels; no real electricity/digital-water accuracy evidence. No training." }, OcrEvaluation.Json));
        Console.WriteLine(JsonSerializer.Serialize(new { safetyAssertionsPassed = safe, rows }));
        return safe ? 0 : 1;
    }
}
