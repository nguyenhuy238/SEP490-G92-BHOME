using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

internal static class WaterLocalizationAudit
{
    public static async Task<int> RunAsync(string yolo, string images, string manifestPath, string report)
    {
        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(manifestPath))!;
        using var file = File.OpenRead(Path.Combine(yolo, YoloMeterSceneDetector.FileName));
        if (!Convert.ToHexString(SHA256.HashData(file)).Equals(YoloMeterSceneDetector.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Stage1 checksum mismatch.");
        using var settings = new SessionOptions { IntraOpNumThreads = 2, InterOpNumThreads = 1, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        using var session = new InferenceSession(Path.Combine(yolo, YoloMeterSceneDetector.FileName), settings);
        var options = new OcrOptions { MeterDetector = new() { Enabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        var rows = new List<object>();
        foreach (var name in manifest.Keys.Where(k => k.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)).Order())
        {
            if (name != Path.GetFileName(name)) throw new InvalidDataException("Public filename required.");
            var bytes = await File.ReadAllBytesAsync(Path.Combine(images, name));
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(manifest[name], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Image checksum mismatch.");
            using var original = Cv2.ImDecode(bytes, ImreadModes.Color); using var image = new Mat();
            var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, image, new((int)(original.Width * scale), (int)(original.Height * scale)), 0, 0, InterpolationFlags.Area);
            var mobileBytes = image.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            using var decoded = Cv2.ImDecode(mobileBytes, ImreadModes.Color);
            var input = YoloMeterSceneDetector.Letterbox(decoded, out var ratio, out var left, out var top);
            using var output = session.Run([NamedOnnxValue.CreateFromTensor(session.InputNames[0], input)]);
            var boxes = YoloMeterSceneDetector.Decode(output.First().AsTensor<float>(), decoded.Size(), ratio, left, top, .5f, .7f);
            input.Buffer.Span.Clear();
            var windows = boxes.Where(b => b.ClassId == 1).ToArray();
            var unclear = boxes.Where(b => b.ClassId == 12).ToArray();
            var overlaps = unclear.Select(u => new
            {
                u.Confidence,
                points = Points(u.Box.Points()),
                insideAabb = windows.Any(w => w.Box.BoundingRect().Contains(new Point((int)u.Box.Center.X, (int)u.Box.Center.Y))),
                insideOriented = windows.Any(w => Cv2.PointPolygonTest(w.Box.Points(), u.Box.Center, false) >= 0)
            }).ToArray();
            var scene = detector.Detect(decoded, default);
            var originalSelection = MeterSceneSelection.Select(scene, decoded.Size(), OcrDocumentKind.MechanicalWater, .7f);
            var candidateScene = scene with { Warnings = scene.Warnings.Where(w => w != "unclear_digit" || overlaps.Any(u => u.insideOriented)).ToArray() };
            var candidateSelection = MeterSceneSelection.Select(candidateScene, decoded.Size(), OcrDocumentKind.MechanicalWater, .7f);
            rows.Add(new
            {
                imageId = name,
                sha256 = manifest[name],
                windowCount = windows.Length,
                windows = windows.Select(w => new { w.Confidence, points = Points(w.Box.Points()) }),
                unclear = overlaps,
                originalAllowed = originalSelection.CanRecognize,
                originalWarnings = originalSelection.Warnings,
                candidateAllowed = candidateSelection.CanRecognize,
                candidateWarnings = candidateSelection.Warnings
            });
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
        {
            experiment = "oriented-unclear-membership",
            runtimeChanged = false,
            thresholdsUnchanged = true,
            rows
        }, OcrEvaluation.Json));
        Console.WriteLine($"Audited raw localization candidates on {rows.Count} images"); return 0;
    }
    private static float[][] Points(Point2f[] p) => p.Select(v => new[] { v.X, v.Y }).ToArray();
}
