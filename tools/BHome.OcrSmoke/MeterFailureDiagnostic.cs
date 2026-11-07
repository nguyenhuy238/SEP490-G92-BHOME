using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

// Public pinned corpus only. Raw text/coordinates stay in the explicit offline
// output directory; production inference has no hook or logging attached.
internal static class MeterFailureDiagnostic
{
    public static async Task<int> RunAsync(string models, string yolo, string images, string manifestPath, string output)
    {
        Directory.CreateDirectory(output);
        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(manifestPath))!;
        var options = new OcrOptions { Enabled = true, ModelDirectory = models, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>();
        foreach (var name in manifest.Keys.Where(k => k.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)).Order())
        {
            if (name != Path.GetFileName(name)) throw new InvalidDataException("Pinned public filename required.");
            var path = Path.Combine(images, name);
            var labelName = Path.ChangeExtension(name, ".txt");
            foreach (var asset in new[] { name, labelName })
                if (!manifest.TryGetValue(asset, out var hash) || !Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(images, asset)))).Equals(hash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Public fixture checksum mismatch.");
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l))
                .Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).Select(parts => new Label(
                    int.Parse(parts[0], CultureInfo.InvariantCulture), Enumerable.Range(0, 4).Select(i => new Point2f(
                        float.Parse(parts[1 + 2 * i], CultureInfo.InvariantCulture), float.Parse(parts[2 + 2 * i], CultureInfo.InvariantCulture))).ToArray())).ToArray();
            var fullLabels = !labels.Any(l => l.ClassId == 12);
            var expected = string.Concat(labels.Where(l => l.ClassId is >= 2 and < 12).OrderBy(l => l.Points.Average(p => p.X)).Select(l => l.ClassId - 2));
            using var original = Cv2.ImRead(path); using var resized = new Mat();
            var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, resized, new((int)(original.Width * scale), (int)(original.Height * scale)), 0, 0, InterpolationFlags.Area);
            var bytes = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            using var prepared = new ImagePreprocessor(options).Prepare(bytes, OcrDocumentKind.MechanicalWater);
            var sceneClock = Stopwatch.StartNew();
            var scene = detector.Detect(prepared.Image, default);
            var sceneMs = sceneClock.ElapsedMilliseconds;
            var selection = MeterSceneSelection.Select(scene, prepared.Image.Size(), OcrDocumentKind.MechanicalWater, .7f);
            var windows = scene.Meters.SelectMany(m => m.ReadingRegions ?? []).Concat(scene.StandaloneReadingRegions).ToArray();
            var gtWindows = labels.Where(l => l.ClassId == 1).Select(l => l.Points.Select(p => new Point2f(p.X * prepared.Image.Width, p.Y * prepared.Image.Height)).ToArray()).ToArray();
            var predicted = windows.Select(w => w.OrientedBounds?.Points() ?? new Point2f[] { new(w.Bounds.Left, w.Bounds.Top), new(w.Bounds.Right, w.Bounds.Top), new(w.Bounds.Right, w.Bounds.Bottom), new(w.Bounds.Left, w.Bounds.Bottom) }).ToArray();
            var bestIoU = gtWindows.Length == 1 && predicted.Length > 0 ? predicted.Max(p => IoU(p, gtWindows[0])) : (double?)null;
            var modes = new List<object>();
            using (var input = new MemoryStream(bytes))
            {
                var timer = Stopwatch.StartNew();
                var actual = await service.ExtractAsync(input, OcrDocumentKind.MechanicalWater, default);
                modes.Add(new { mode = "A_full_pipeline", value = actual.ProposedFields.GetValueOrDefault("reading"), actual.IsFallback, actual.Warnings,
                    exact = fullLabels && actual.ProposedFields.GetValueOrDefault("reading") == expected,
                    falseProposal = fullLabels && actual.ProposedFields.TryGetValue("reading", out var actualValue) && actualValue != expected,
                    elapsedMs = timer.ElapsedMilliseconds });
            }
            if (selection.Crop is { } rect && selection.CanRecognize)
            {
                using var crop = selection.OrientedCrop is { } pose ? OnnxOcrEngine.Crop(prepared.Image, pose) : new Mat(prepared.Image, rect).Clone();
                modes.Add(Inspect(crop, "predicted_window", name, engine, digits, prepared.Warnings.Concat(selection.Warnings).ToArray(), output));
            }
            if (gtWindows.Length == 1)
            {
                using var oracle = Warp(prepared.Image, gtWindows[0]);
                modes.Add(Inspect(oracle, "oracle_window", name, engine, digits, prepared.Warnings, output));
            }
            rows.Add(new { imageId = name, sourceSha256 = manifest[name], dataset = "pinned_author_water",
                physicalMeterGroup = (string?)null, physicalMeterGroupVerified = false,
                expectedCategory = "water_mechanical", categorySource = "publisher_water_corpus_not_four_class_validation",
                expectedDigits = fullLabels ? expected : null, partialAnnotatedDigits = fullLabels ? null : expected,
                readability = "not_independently_reviewed", unknownDigitAnnotations = labels.Count(l => l.ClassId == 12),
                decimalPlaces = (int?)null, billingRegister = "not_annotated", classification = "not_run_trusted_profile_path",
                width = prepared.Image.Width, height = prepared.Image.Height, stage1ElapsedMs = sceneMs,
                stage1Available = scene.IsAvailable, meters = scene.Meters.Select(m => new { bounds = Rectangle(m.Bounds), m.Confidence }),
                sceneWarnings = scene.Warnings, selection.CanRecognize, selectionWarnings = selection.Warnings,
                predictedWindows = windows.Select((w, i) => new { points = Points(predicted[i]), w.Confidence }),
                groundTruthWindows = gtWindows.Select(Points), bestWindowIoU = bestIoU,
                localizedAtIoU50 = gtWindows.Length == 1 && predicted.Length == 1 && bestIoU >= .5,
                qualityWarnings = prepared.Warnings, modes });
            Array.Clear(bytes);
            Console.WriteLine($"Diagnosed public fixture {rows.Count}");
        }
        await File.WriteAllTextAsync(Path.Combine(output, "diagnostic-public-only.json"), JsonSerializer.Serialize(new {
            engine = OnnxOcrEngine.Version, manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath))),
            thresholdSelectionPerformed = false, oracleIsProductionPrediction = false, rows,
            limitations = new[] { "Publisher polygons/digit labels; no independent human review of every label.",
                "u is incomplete ground truth, not proof the image is unreadable.", "No verified decimal/register or physical-meter grouping.",
                "B uses recognizers on the annotated crop; it is not localization or end-to-end accuracy." }
        }, OcrEvaluation.Json));
        return 0;
    }

    private static object Inspect(Mat crop, string mode, string imageId, OnnxOcrEngine engine, YoloWaterDigitRecognizer digits,
        IReadOnlyList<string> warnings, string output)
    {
        var timer = Stopwatch.StartNew();
        var ppRaw = engine.InspectMeterCrop(crop, false, default);
        var pp = ppRaw with { Warnings = [.. warnings, .. ppRaw.Warnings] };
        var directRaw = engine.InspectMeterCrop(crop, true, default);
        var direct = directRaw with { Warnings = [.. warnings, .. directRaw.Warnings] };
        var stage2 = digits.Recognize(crop, default);
        var parsed = OcrFieldParser.Parse(pp, OcrDocumentKind.MechanicalWater);
        var fusedText = MeterRecognitionFusion.Combine(pp, stage2);
        var fused = OcrFieldParser.Parse(fusedText, OcrDocumentKind.MechanicalWater);
        var filename = Path.GetFileNameWithoutExtension(imageId) + "-" + mode + ".png";
        crop.SaveImage(Path.Combine(output, filename));
        using var gray = new Mat(); using var laplace = new Mat();
        Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY); Cv2.Laplacian(gray, laplace, MatType.CV_64F);
        Cv2.MeanStdDev(laplace, out _, out var deviation);
        return new { mode, cropFile = filename, width = crop.Width, height = crop.Height,
            cropLaplacianVariance = deviation.Val0 * deviation.Val0, warnings,
            ppRaw = pp.Lines.Select(l => new { l.Text, l.Confidence, l.Bounds }), ppWarnings = pp.Warnings,
            ppNumericCandidate = parsed.ProposedFields.GetValueOrDefault("reading"), parserWarnings = parsed.Warnings,
            ppDirectRaw = direct.Lines.Select(l => new { l.Text, l.Confidence }),
            ppDirectNumericCandidate = OcrFieldParser.Parse(direct, OcrDocumentKind.MechanicalWater).ProposedFields.GetValueOrDefault("reading"),
            stage2Value = stage2.Digits, stage2.Confidence, stage2Warnings = stage2.Warnings,
            digitCandidates = stage2.Detections.OrderBy(d => d.Box.Center.X).Select((d, i) => new { order = i, d.ClassId, d.Confidence, points = Points(d.Box.Points()) }),
            fusionRaw = fusedText.Lines.Select(l => new { l.Text, l.Confidence }), fusionWarnings = fusedText.Warnings,
            fusedValue = fused.ProposedFields.GetValueOrDefault("reading"), finalParserWarnings = fused.Warnings,
            registerVerification = "not_annotated_preserve_veto", precisionVerification = "no_ground_truth_server_metadata_required",
            elapsedMs = timer.ElapsedMilliseconds };
    }
    internal static double IoU(Point2f[] first, Point2f[] second)
    {
        var a = Cv2.ConvexHull(first); var b = Cv2.ConvexHull(second);
        var intersection = Cv2.IntersectConvexConvex(a, b, out _);
        var union = Math.Abs(Cv2.ContourArea(a)) + Math.Abs(Cv2.ContourArea(b)) - intersection;
        return union > 0 ? intersection / union : 0;
    }
    internal static Mat Warp(Mat image, Point2f[] polygon)
    {
        var ordered = polygon.OrderBy(p => p.X).ToArray(); var left = ordered.Take(2).OrderBy(p => p.Y).ToArray(); var right = ordered.Skip(2).OrderBy(p => p.Y).ToArray();
        Point2f[] source = [left[0], right[0], right[1], left[1]];
        var width = Math.Max(2, (int)Math.Max(source[0].DistanceTo(source[1]), source[2].DistanceTo(source[3])));
        var height = Math.Max(2, (int)Math.Max(source[0].DistanceTo(source[3]), source[1].DistanceTo(source[2])));
        using var transform = Cv2.GetPerspectiveTransform(source, new Point2f[] { new(0, 0), new(width - 1, 0), new(width - 1, height - 1), new(0, height - 1) });
        var result = new Mat(); Cv2.WarpPerspective(image, result, transform, new(width, height), InterpolationFlags.Linear, BorderTypes.Replicate); return result;
    }
    private static float[][] Points(Point2f[] points) => points.Select(p => new[] { p.X, p.Y }).ToArray();
    private static int[] Rectangle(Rect rect) => [rect.X, rect.Y, rect.Width, rect.Height];
    private sealed record Label(int ClassId, Point2f[] Points);
}
