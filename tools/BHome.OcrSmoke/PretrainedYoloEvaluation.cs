using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

internal static class PretrainedYoloEvaluation
{
    public static async Task<int> RunAsync(string ocrModels, string yoloModels, string images, string reportPath)
    {
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = ocrModels,
            MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, ModelDirectory = yoloModels }
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var candidateEngine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector);
        using var baselineEngine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var candidate = new LocalOcrService(options, new Lazy<IOcrEngine>(() => candidateEngine), NullLogger<LocalOcrService>.Instance);
        using var baseline = new LocalOcrService(options, new Lazy<IOcrEngine>(() => baselineEngine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>(); var times = new List<long>(); var baselineTimes = new List<long>();
        var meters = 0; var windows = 0; var exactBefore = 0; var exactAfter = 0; var labeled = 0; var proposed = 0; var incorrect = 0; var fallback = 0;
        var baselineProposed = 0; var baselineIncorrect = 0;
        var preprocessingParity = 0; var detectionParity = 0; var autoTimes = new List<long>();
        using var rawSession = new InferenceSession(Path.Combine(yoloModels, YoloMeterSceneDetector.FileName));
        using var nativeReport = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(yoloModels, "native-onnx-parity.json")));
        var nativeSamples = nativeReport.RootElement[0].GetProperty("samples");
        foreach (var path in Directory.GetFiles(images, "*.jpg").Order())
        {
            using var frame = Cv2.ImRead(path);
            using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var scene = detector.Detect(frame, cancel.Token);
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expectedBody = GroundTruth(labels.Single(l => l[0] == "0"), frame.Size());
            var expectedWindow = GroundTruth(labels.Single(l => l[0] == "1"), frame.Size());
            var bodyHit = scene.Meters.Any(m => RectangleIoU(m.Bounds, expectedBody.BoundingRect()) >= .5);
            var region = scene.Meters.SelectMany(m => m.ReadingRegions ?? []).Concat(scene.StandaloneReadingRegions).ToArray();
            var windowHit = region.Any(r => RotatedIoU(r.OrientedBounds!.Value, expectedWindow) >= .5);
            if (bodyHit) meters++; if (windowHit) windows++;
            var hasUnclear = labels.Any(l => l[0] == "12");
            var expectedDigits = string.Concat(labels.Where(l => int.Parse(l[0], CultureInfo.InvariantCulture) >= 2 && l[0] != "12")
                .OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], CultureInfo.InvariantCulture)))
                .Select(l => (int.Parse(l[0], CultureInfo.InvariantCulture) - 2).ToString(CultureInfo.InvariantCulture)));
            using var beforeInput = File.OpenRead(path); var clock = Stopwatch.StartNew();
            var before = await baseline.ExtractAsync(beforeInput, OcrDocumentKind.MechanicalWater, default);
            baselineTimes.Add(clock.ElapsedMilliseconds);
            if (before.ProposedFields.ContainsKey("reading")) baselineProposed++;
            using var afterInput = File.OpenRead(path); clock.Restart();
            var after = await candidate.ExtractAsync(afterInput, OcrDocumentKind.MechanicalWater, default);
            times.Add(clock.ElapsedMilliseconds);
            if (!after.ProposedFields.ContainsKey("reading")) fallback++; else proposed++;
            var correctBefore = !hasUnclear && before.ProposedFields.GetValueOrDefault("reading") == expectedDigits;
            var correctAfter = !hasUnclear && after.ProposedFields.GetValueOrDefault("reading") == expectedDigits;
            if (!hasUnclear) { labeled++; if (correctBefore) exactBefore++; if (correctAfter) exactAfter++; if (!correctAfter && after.ProposedFields.ContainsKey("reading")) incorrect++; if (!correctBefore && before.ProposedFields.ContainsKey("reading")) baselineIncorrect++; }
            using var autoInput = File.OpenRead(path); clock.Restart(); var auto = await candidate.ExtractAutomaticAsync(autoInput, default);
            autoTimes.Add(clock.ElapsedMilliseconds);
            var tensor = YoloMeterSceneDetector.Letterbox(frame, out var scale, out var left, out var top);
            var referenceInput = Floats(Path.Combine(yoloModels, "water-stage1.pt." + Path.GetFileNameWithoutExtension(path) + ".input.f32"));
            var deltaInput = tensor.Buffer.Span.ToArray().Zip(referenceInput, (a, b) => Math.Abs(a - b)).Max();
            if (deltaInput <= 1e-6) preprocessingParity++;
            using var result = rawSession.Run([NamedOnnxValue.CreateFromTensor(rawSession.InputNames[0], tensor)]);
            var output = result.First().AsTensor<float>();
            var decoded = YoloMeterSceneDetector.Decode(output, frame.Size(), scale, left, top, .5f, .7f).Where(b => b.ClassId is 0 or 1).ToArray();
            var native = nativeSamples.EnumerateArray().Single(s => s.GetProperty("file").GetString() == Path.GetFileName(path)).GetProperty("detections").EnumerateArray().ToArray();
            var parity = native.Length == decoded.Length && native.All(n => decoded.Any(d => d.ClassId == n.GetProperty("classId").GetInt32() &&
                Math.Abs(d.Confidence - n.GetProperty("confidence").GetSingle()) < .002 &&
                Math.Abs(d.Box.Center.X - n.GetProperty("xywhr")[0].GetSingle()) < .1 &&
                Math.Abs(d.Box.Center.Y - n.GetProperty("xywhr")[1].GetSingle()) < .1 &&
                SameCorners(d.Box, new(new(n.GetProperty("xywhr")[0].GetSingle(), n.GetProperty("xywhr")[1].GetSingle()),
                    new(n.GetProperty("xywhr")[2].GetSingle(), n.GetProperty("xywhr")[3].GetSingle()), n.GetProperty("xywhr")[4].GetSingle() * 180f / MathF.PI))));
            if (parity) detectionParity++;
            tensor.Buffer.Span.Clear();
            rows.Add(new
            {
                index = rows.Count,
                bodyHit,
                windowHit,
                hasUnclear,
                exactBefore = correctBefore,
                exactAfter = correctAfter,
                after.IsFallback,
                warnings = after.Warnings,
                auto.ClassificationStatus,
                auto.PartialCategory,
                automaticReadingAvailable = auto.MeterProposal?.ProposedFields.ContainsKey("reading") == true,
                cropPreviewAvailable = auto.CropPreviewDataUri is not null,
                preprocessingMaxDelta = deltaInput,
                detectionParity = parity,
                elapsedMilliseconds = times[^1],
                automaticMilliseconds = autoTimes[^1],
                baselineMilliseconds = baselineTimes[^1],
                baselineReadingAvailable = before.ProposedFields.ContainsKey("reading")
            });
            Console.WriteLine(JsonSerializer.Serialize(rows[^1]));
        }
        var summary = new
        {
            images = rows.Count,
            meterHitsIoU50 = meters,
            windowHitsIoU50 = windows,
            fullyLabeledReadings = labeled,
            exactBefore,
            exactAfter,
            proposed,
            incorrectOnFullyLabeled = incorrect,
            manualFallbacks = fallback,
            fallbackRatePercent = 100m * fallback / rows.Count,
            preprocessingParity,
            detectionParity,
            baselineProposed,
            baselineIncorrectOnFullyLabeled = baselineIncorrect,
            baselineManualFallbacks = rows.Count - baselineProposed,
            baselineP50Milliseconds = baselineTimes.Order().ElementAt((int)Math.Ceiling(times.Count * .5) - 1),
            baselineP95Milliseconds = baselineTimes.Order().ElementAt((int)Math.Ceiling(times.Count * .95) - 1),
            p50Milliseconds = times.Order().ElementAt((int)Math.Ceiling(times.Count * .5) - 1),
            p95Milliseconds = times.Order().ElementAt((int)Math.Ceiling(times.Count * .95) - 1),
            maxMilliseconds = times.Max(),
            within10Seconds = times.Count(t => t <= 10000),
            automaticP50Milliseconds = autoTimes.Order().ElementAt((int)Math.Ceiling(autoTimes.Count * .5) - 1),
            automaticP95Milliseconds = autoTimes.Order().ElementAt((int)Math.Ceiling(autoTimes.Count * .95) - 1),
            automaticWithin10Seconds = autoTimes.Count(t => t <= 10000),
            classificationAccuracy = (decimal?)null,
            accuracyTargetMet = false,
            minimum50ImageEvaluationComplete = false,
            limitation = "Ten selected public author test images (first five plus five clear annotations); three unclear readings excluded from exact-match denominator. Not an independent BHOME holdout or four-class classifier. No training."
        };
        await File.WriteAllTextAsync(reportPath, JsonSerializer.Serialize(new { summary, rows }, OcrEvaluation.Json));
        Console.WriteLine(JsonSerializer.Serialize(summary));
        return preprocessingParity == rows.Count && detectionParity == rows.Count && windows > 0 ? 0 : 1;
    }
    private static float[] Floats(string path) { var bytes = File.ReadAllBytes(path); var values = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, values, 0, bytes.Length); return values; }
    private static RotatedRect GroundTruth(string[] label, Size size) => Cv2.MinAreaRect(Enumerable.Range(0, 4).Select(i => new Point2f(
        float.Parse(label[1 + i * 2], CultureInfo.InvariantCulture) * size.Width, float.Parse(label[2 + i * 2], CultureInfo.InvariantCulture) * size.Height)));
    private static double RectangleIoU(Rect a, Rect b) { var i = a.Intersect(b); return (double)i.Width * i.Height / ((double)a.Width * a.Height + (double)b.Width * b.Height - (double)i.Width * i.Height); }
    private static double RotatedIoU(RotatedRect a, RotatedRect b)
    {
        Cv2.RotatedRectangleIntersection(a, b, out var points);
        var intersection = points.Length >= 3 ? Math.Abs(Cv2.ContourArea(points)) : 0;
        return intersection / (a.Size.Width * a.Size.Height + b.Size.Width * b.Size.Height - intersection);
    }
    // Native regularizes w/h and theta; compare unordered corners to permit the
    // equivalent (h,w,theta+90) representation. Near-coincident OpenCV polygons
    // can produce unstable intersections, so IoU is only used against GT above.
    private static bool SameCorners(RotatedRect a, RotatedRect b) => a.Points().All(p =>
        b.Points().Any(q => Math.Abs(p.X - q.X) < .1 && Math.Abs(p.Y - q.Y) < .1));
}
