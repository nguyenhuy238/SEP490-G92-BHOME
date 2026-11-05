using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

internal static class MeterRecognitionComparison
{
    public static async Task<int> RunAsync(string models, string yolo, string images, string output)
    {
        Directory.CreateDirectory(output);
        var options = new OcrOptions { Enabled = true, ModelDirectory = models, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector);
        var rows = new List<object>(); var details = new List<object>();
        foreach (var path in Directory.GetFiles(images, "*.jpg").Order())
        {
            var watch = Stopwatch.StartNew();
            using var frame = Cv2.ImRead(path);
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expected = string.Concat(labels.Where(l => int.Parse(l[0]) is >= 2 and < 12)
                .OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], CultureInfo.InvariantCulture)))
                .Select(l => int.Parse(l[0]) - 2));
            var clear = !labels.Any(l => l[0] == "12");
            var scene = detector.Detect(frame, default);
            var selected = MeterSceneSelection.Select(scene, frame.Size(), OcrDocumentKind.MechanicalWater, .7f);
            var windows = scene.Meters.SelectMany(m => m.ReadingRegions ?? []).Concat(scene.StandaloneReadingRegions).ToArray();
            var variants = new List<object>(); var local = new List<object>();
            if (windows.Length == 1 && windows[0].OrientedBounds is { } pose)
            {
                var variantsToRun = new[] { "legacy", "canonical", "margin03", "margin08" };
                foreach (var name in variantsToRun)
                {
                    using var crop = name == "legacy" ? OnnxOcrEngine.Crop(frame, pose) : MeterWindowCrop.Create(frame, pose,
                        name == "margin08" ? .8f : name == "margin03" ? .3f : 0, name == "canonical" ? 0 : .15f);
                    var filename = Path.GetFileNameWithoutExtension(path) + "-" + name + ".png";
                    crop.SaveImage(Path.Combine(output, filename)); // Public fixtures only, explicit offline evaluator.
                    var pp = engine.InspectMeterCrop(crop, false, default);
                    var direct = engine.InspectMeterCrop(crop, true, default);
                    using var enhanced = Enhance(crop);
                    var contrast = engine.InspectMeterCrop(enhanced, true, default);
                    var stage2 = digits.Recognize(crop, default);
                    string? Value(OcrText text) => OcrFieldParser.Parse(text, OcrDocumentKind.MechanicalWater).ProposedFields.GetValueOrDefault("reading");
                    var a = Value(pp); var d = Value(direct); var e = Value(contrast); var b = stage2.Digits;
                    // Diagnostic C keeps the same scene guards, never picks by score.
                    var c = selected.CanRecognize && b is not null && (a is null || a == b) ? b : null;
                    object Metric(string? value) => new { proposed = value is not null, exact = clear && value == expected, falseProposal = clear && value is not null && value != expected };
                    variants.Add(new { name, width = crop.Width, height = crop.Height, pp = Metric(selected.CanRecognize ? a : null),
                        ppDirect = Metric(selected.CanRecognize ? d : null), ppContrast = Metric(selected.CanRecognize ? e : null),
                        stage2 = Metric(selected.CanRecognize ? b : null), combined = Metric(c), digitWarnings = stage2.Warnings,
                        recognizerConflict = a is not null && b is not null && a != b });
                    local.Add(new { name, expected, pp = pp.Lines.Select(l => new { l.Text, l.Confidence, l.Bounds }), direct = direct.Lines.Select(l => new { l.Text, l.Confidence }),
                        contrast = contrast.Lines.Select(l => new { l.Text, l.Confidence }), parsed = a, stage2, sceneGuardsPassed = selected.CanRecognize });
                }
            }
            rows.Add(new { file = Path.GetFileName(path), clear, meterCount = scene.Meters.Count, windowCount = windows.Length,
                sceneWarnings = selected.Warnings, canRecognize = selected.CanRecognize, elapsedMilliseconds = watch.ElapsedMilliseconds, variants });
            details.Add(new { file = Path.GetFileName(path), clear, expected, variants = local });
            Console.WriteLine($"Compared {rows.Count} public images");
        }
        await File.WriteAllTextAsync(Path.Combine(output, "comparison.json"), JsonSerializer.Serialize(new { rows }, OcrEvaluation.Json));
        await File.WriteAllTextAsync(Path.Combine(output, "public-only-diagnostics.json"), JsonSerializer.Serialize(new { details }, OcrEvaluation.Json));
        return 0;
    }
    private static Mat Enhance(Mat crop)
    {
        using var gray = new Mat(); Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY);
        using var clahe = Cv2.CreateCLAHE(2, new(8, 8)); clahe.Apply(gray, gray);
        var result = new Mat(); Cv2.CvtColor(gray, result, ColorConversionCodes.GRAY2BGR); return result;
    }
}
