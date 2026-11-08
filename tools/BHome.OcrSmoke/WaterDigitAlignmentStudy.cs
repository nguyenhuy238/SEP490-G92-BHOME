using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

// Offline public validation experiment. Nothing here registers a runtime reader.
// Unlike old display-margin probes, the PP ROI comes from all detected digit
// polygons. Ground truth never determines crop geometry, count or emitted value.
internal static class WaterDigitAlignmentStudy
{
    public static async Task<int> RunAsync(string ocr, string yolo, string images, string manifestPath, string excludedManifestPath, string report)
    {
        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(manifestPath))!;
        var excluded = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(excludedManifestPath))!;
        var excludedHashes = excluded.Where(p => p.Key.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase))
            .Select(p => p.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (manifest.Any(p => p.Key.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) && excludedHashes.Contains(p.Value)))
            throw new InvalidDataException("Validation source overlaps excluded held-out images.");
        // The caller supplies a frozen validation manifest with the known exact
        // overlap removed. Assert that each input and label matches its hash.
        var options = new OcrOptions { Enabled = true, ModelDirectory = ocr, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        var rows = new List<object>();
        foreach (var name in manifest.Keys.Where(n => n.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)).Order())
        {
            if (name != Path.GetFileName(name)) throw new InvalidDataException("Only public fixture filenames are allowed.");
            var path = Path.Combine(images, name);
            var labelName = Path.ChangeExtension(name, ".txt");
            foreach (var asset in new[] { name, labelName })
            {
                if (!manifest.TryGetValue(asset, out var expectedHash) ||
                    !Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(images, asset)))).Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Public validation fixture hash mismatch.");
            }
            var labels = File.ReadAllLines(Path.ChangeExtension(path, ".txt")).Where(l => !string.IsNullOrWhiteSpace(l))
                .Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expected = string.Concat(labels.Where(l => int.Parse(l[0], CultureInfo.InvariantCulture) is >= 2 and < 12)
                .OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], CultureInfo.InvariantCulture)))
                .Select(l => int.Parse(l[0], CultureInfo.InvariantCulture) - 2));
            var clear = !labels.Any(l => l[0] == "12");
            var clock = Stopwatch.StartNew();
            using var original = Cv2.ImRead(path); using var resized = new Mat();
            var ratio = Math.Min(1, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, resized, new((int)(original.Width * ratio), (int)(original.Height * ratio)), 0, 0, InterpolationFlags.Area);
            var bytes = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            using var prepared = new ImagePreprocessor(options).Prepare(bytes, OcrDocumentKind.MechanicalWater);
            Array.Clear(bytes);
            var scene = detector.Detect(prepared.Image, default);
            var selection = MeterSceneSelection.Select(scene, prepared.Image.Size(), OcrDocumentKind.MechanicalWater, .7f);
            var variants = new List<object>();
            if (selection.CanRecognize && selection.OrientedCrop is { } pose)
            {
                using var display = OnnxOcrEngine.Crop(prepared.Image, pose);
                var digit = digits.Recognize(display, default);
                var pp = engine.InspectMeterCrop(display, false, default);
                pp = pp with { Warnings = [.. prepared.Warnings, .. selection.Warnings, .. pp.Warnings] };
                var baseline = OcrFieldParser.Parse(MeterRecognitionFusion.Combine(pp, digit), OcrDocumentKind.MechanicalWater);
                variants.Add(Observation("runtime_baseline", baseline, expected, clear));
                if (digit.Digits is not null && TryDigitRow(display.Size(), digit.Detections, out var row))
                {
                    using var aligned = OnnxOcrEngine.Crop(display, row);
                    var rowText = engine.InspectMeterCrop(aligned, true, default);
                    var fullProposal = OcrFieldParser.Parse(pp, OcrDocumentKind.MechanicalWater);
                    // Preserve all original non-billing/type/scene/blur vetoes.
                    // Original valid numeric disagreement remains a distinct policy
                    // risk measured below; no change to runtime fusion is made.
                    var veto = fullProposal.Warnings.Any(w => w is "billing_register_unverified" or "meter_type_mismatch" or
                        "multiple_reading_regions" or "blur_or_low_detail" or "text_region_limit" or "orientation_uncertain");
                    var candidate = OcrFieldParser.Parse(MeterRecognitionFusion.Combine(rowText with
                    { Warnings = [.. pp.Warnings] }, digit), OcrDocumentKind.MechanicalWater);
                    if (veto) candidate = candidate with { ProposedFields = new Dictionary<string, string>(), IsFallback = true };
                    variants.Add(Observation("digit_polygon_aligned_primary_pp", candidate, expected, clear));
                    // A degraded/malformed new PP line cannot be used to erase a
                    // valid original disagreement by triggering stage2-only review.
                    var alignedProposal = OcrFieldParser.Parse(rowText, OcrDocumentKind.MechanicalWater);
                    var agrees = alignedProposal.ProposedFields.TryGetValue("reading", out var alignedValue) &&
                        alignedValue.Replace(".", "", StringComparison.Ordinal) == digit.Digits;
                    var strict = agrees ? candidate : candidate with { ProposedFields = new Dictionary<string, string>(), IsFallback = true };
                    variants.Add(Observation("aligned_pp_must_agree", strict, expected, clear));
                    variants.Add(new { name = "diagnostics", stage2 = digit.Digits, pp = fullProposal.ProposedFields.GetValueOrDefault("reading"),
                        alignedPp = rowText.Lines.Select(l => new { l.Text, l.Confidence }), veto,
                        originalDisagreement = fullProposal.ProposedFields.TryGetValue("reading", out var full) && full.Replace(".", "") != digit.Digits });
                }
            }
            rows.Add(new { imageId = name, sha256 = manifest[name], completeDigitGroundTruth = clear ? expected : null,
                partialDigitGroundTruth = !clear ? expected : null, sceneAllowed = selection.CanRecognize,
                sceneWarnings = selection.Warnings, elapsedMs = clock.ElapsedMilliseconds, variants });
            Console.WriteLine($"Aligned validation fixture {rows.Count}");
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { experiment = "digit-polygon-aligned-pp-v1",
            inputTransform = "mobile-1600-jpeg85", selectionSet = "historical_author_validation_deduplicated",
            independentAcceptance = false, runtimeEnabled = false,
            manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath))),
            excludedManifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(excludedManifestPath))), rows,
            limitations = new[] { "Digit-only labels; no decimal/register ground truth.", "Shared source/physical-meter independence unknown.",
                "New digit-polygon ROI, not a repeat of display-margin/CLAHE probes.", "Reject if false/unknown proposals increase or exact coverage does not improve on validation; do not select using test." }
        }, OcrEvaluation.Json));
        return 0;
    }

    private static object Observation(string name, OcrProposal proposal, string expected, bool clear)
    {
        var value = proposal.ProposedFields.GetValueOrDefault("reading");
        return new { name, proposed = value is not null, exactDigits = clear && value == expected,
            falseProposal = clear && value is not null && value != expected, unknownGroundTruth = !clear && value is not null,
            warnings = proposal.Warnings };
    }

    internal static bool TryDigitRow(Size display, IReadOnlyList<YoloMeterSceneDetector.YoloBox> boxes, out RotatedRect row)
    {
        row = default;
        if (YoloWaterDigitRecognizer.Assemble(boxes).Digits is null) return false;
        var points = boxes.SelectMany(b => b.Box.Points()).ToArray();
        if (points.Any(p => !float.IsFinite(p.X + p.Y))) return false;
        row = Cv2.MinAreaRect(points);
        // Fixed symmetric context around the complete polygon union; never use
        // ground-truth digit count, reading value or confidence to resize the ROI.
        var margin = Math.Min(row.Size.Width, row.Size.Height) * .08f;
        row.Size = new(row.Size.Width + 2 * margin, row.Size.Height + 2 * margin);
        return row.Points().All(p => p.X >= 0 && p.Y >= 0 && p.X < display.Width && p.Y < display.Height);
    }
}
