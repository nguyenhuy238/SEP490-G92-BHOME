using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

internal static class WaterMeterDecisionAudit
{
    public static async Task<int> RunAsync(string ocr, string yolo, string images, string output)
    {
        Directory.CreateDirectory(output);
        var options = new OcrOptions { ModelDirectory = ocr, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector);
        var rows = new List<object>();
        foreach (var path in Directory.GetFiles(images, "*.jpg").Order())
        {
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expected = string.Concat(labels.Where(l => int.Parse(l[0]) is >= 2 and < 12)
                .OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], CultureInfo.InvariantCulture)))
                .Select(l => int.Parse(l[0]) - 2));
            var clear = !labels.Any(l => l[0] == "12");
            using var original = Cv2.ImRead(path); using var scaled = new Mat();
            var scale = Math.Min(1, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, scaled, new((int)(original.Width * scale), (int)(original.Height * scale)), 0, 0, InterpolationFlags.Area);
            var bytes = scaled.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            using var prepared = new ImagePreprocessor(options).Prepare(bytes, OcrDocumentKind.MechanicalWater);
            Array.Clear(bytes);
            var scene = detector.Detect(prepared.Image, default);
            var selection = MeterSceneSelection.Select(scene, prepared.Image.Size(), OcrDocumentKind.MechanicalWater, .7f);
            var windows = scene.Meters.SelectMany(m => m.ReadingRegions ?? []).Concat(scene.StandaloneReadingRegions).ToArray();
            MeterDigitResult stage2 = new(null, null, ["no_unique_window"]);
            var pp = new OcrText([], OnnxOcrEngine.Version, []);
            var cells = new List<string>();
            if (windows.Length == 1 && windows[0].OrientedBounds is { } pose)
            {
                using var crop = OnnxOcrEngine.Crop(prepared.Image, pose);
                stage2 = digits.Recognize(crop, default);
                pp = engine.InspectMeterCrop(crop, false, default);
                var boxes = stage2.Detections.OrderBy(b => b.Box.Center.X).ToArray();
                // Public offline evaluation only. Cell boundaries come from
                // adjacent model centers, never from the ground-truth digit count.
                for (var i = 0; i < boxes.Length; i++)
                {
                    var center = boxes[i].Box.Center.X;
                    var width = boxes[i].Box.BoundingRect().Width;
                    var left = i == 0 ? center - width * .6f : (center + boxes[i - 1].Box.Center.X) / 2;
                    var right = i == boxes.Length - 1 ? center + width * .6f : (center + boxes[i + 1].Box.Center.X) / 2;
                    var bounds = new Rect((int)Math.Floor(left), 0, Math.Max(1, (int)Math.Ceiling(right - left)), crop.Height).Intersect(new(0, 0, crop.Width, crop.Height));
                    if (bounds.Width <= 0 || bounds.Height <= 0) continue;
                    using var cell = new Mat(crop, bounds);
                    var filename = Path.GetFileNameWithoutExtension(path) + $"-cell-{i}.png";
                    cell.SaveImage(Path.Combine(output, filename)); cells.Add(filename);
                }
            }
            var parsed = OcrFieldParser.Parse(pp, OcrDocumentKind.MechanicalWater);
            var ppValue = parsed.ProposedFields.GetValueOrDefault("reading");
            var fused = OcrFieldParser.Parse(MeterRecognitionFusion.Combine(pp, stage2), OcrDocumentKind.MechanicalWater);
            var value = selection.CanRecognize ? fused.ProposedFields.GetValueOrDefault("reading") : null;
            rows.Add(new { file = Path.GetFileName(path), sourceSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))).ToLowerInvariant(),
                clear, expected, sceneAvailable = scene.IsAvailable, sceneAllowed = selection.CanRecognize,
                sceneWarnings = selection.Warnings, imageWarnings = prepared.Warnings, ppLines = pp.Lines.Count,
                ppValue, ppWarnings = parsed.Warnings, stage2Value = stage2.Digits, stage2Confidence = stage2.Confidence,
                stage2Warnings = stage2.Warnings, fusedValue = value, cells });
        }
        await File.WriteAllTextAsync(Path.Combine(output, "audit-public-only.json"), JsonSerializer.Serialize(new { rows }, OcrEvaluation.Json));
        Console.WriteLine($"Audited {rows.Count} public images; no private inputs or training.");
        return 0;
    }
}
