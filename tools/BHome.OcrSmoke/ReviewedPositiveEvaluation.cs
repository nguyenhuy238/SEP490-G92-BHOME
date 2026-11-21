using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

// Public, reviewed digit candidates only. Crops use annotation polygons and must
// never be scored as automatic display detection or end-to-end billing accuracy.
internal static class ReviewedPositiveEvaluation
{
    public static async Task<int> RunAsync(string ocr, string yolo, string manifest, string root, string report)
    {
        using var data = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = ocr,
            MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo }
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>();
        foreach (var sample in data.RootElement.GetProperty("samples").EnumerateArray())
        {
            if (sample.GetProperty("split").GetString() != "test" ||
                sample.GetProperty("provenance").GetProperty("kind").GetString() != "public")
                throw new InvalidDataException("Only frozen public test candidates are allowed.");
            var kind = sample.GetProperty("category").GetString() switch
            {
                "water_mechanical" => OcrDocumentKind.MechanicalWater,
                "water_digital" => OcrDocumentKind.DigitalWater,
                "electricity_mechanical" => OcrDocumentKind.MechanicalElectricity,
                "electricity_digital" => OcrDocumentKind.DigitalElectricity,
                _ => throw new InvalidDataException("Unsupported meter category.")
            };
            var reading = sample.GetProperty("reading");
            var expected = reading.GetProperty("digits").GetString();
            if (expected is null || expected.Length is < 1 or > 12 || expected.Any(c => c is < '0' or > '9') ||
                reading.GetProperty("unreadablePositions").GetArrayLength() != 0)
                throw new InvalidDataException("Complete reviewed digits required.");
            var multiple = reading.GetProperty("displayState").GetString() == "multiple";
            var source = PublicMeterEvaluation.ImagePath(root, sample);
            using var original = Cv2.ImRead(source);
            using var mobile = new Mat();
            var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, mobile, new(Math.Max(1, (int)(original.Width * scale)), Math.Max(1, (int)(original.Height * scale))), 0, 0, InterpolationFlags.Area);
            var bytes = mobile.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            var observations = new List<object>();
            using (var input = new MemoryStream(bytes))
            {
                var clock = Stopwatch.StartNew();
                var proposal = await service.ExtractAsync(input, kind, default);
                observations.Add(Observation("trusted_profile_full_frame", proposal, expected, multiple, clock.ElapsedMilliseconds));
            }
            using (var input = new MemoryStream(bytes))
            {
                var clock = Stopwatch.StartNew();
                var automatic = await service.ExtractAutomaticAsync(input, default);
                observations.Add(new
                {
                    mode = "automatic_full_frame",
                    automatic.ClassificationStatus,
                    automatic.DetectedCategory,
                    classificationCorrect = automatic.ClassificationStatus == "classified" && automatic.DetectedCategory == sample.GetProperty("category").GetString(),
                    classificationWrong = automatic.ClassificationStatus == "classified" && automatic.DetectedCategory != sample.GetProperty("category").GetString(),
                    proposal = automatic.MeterProposal?.ProposedFields.ContainsKey("reading") == true,
                    automatic.Warnings,
                    elapsedMs = clock.ElapsedMilliseconds,
                    expectedMultiMeterRejection = multiple,
                    rejectedMultiMeter = multiple && automatic.MeterProposal?.ProposedFields.ContainsKey("reading") != true
                });
            }
            // Source compression precedes both full-frame and oracle-window probes.
            using var decoded = Cv2.ImDecode(bytes, ImreadModes.Color);
            Array.Clear(bytes);
            var points = sample.GetProperty("windowPolygon").EnumerateArray()
                .Select(p => new Point2f(p[0].GetSingle() * decoded.Width, p[1].GetSingle() * decoded.Height)).ToArray();
            if (points.Length != 4 || points.Any(p => !float.IsFinite(p.X + p.Y) || p.X < 0 || p.Y < 0 || p.X > decoded.Width || p.Y > decoded.Height))
                throw new InvalidDataException("Invalid reviewed window polygon.");
            using var crop = Window(decoded, points);
            foreach (var direct in new[] { false, true })
            {
                var clock = Stopwatch.StartNew();
                var text = engine.InspectMeterCrop(crop, direct, default);
                observations.Add(Observation(direct ? "oracle_window_pp_direct" : "oracle_window_pp_page",
                    OcrFieldParser.Parse(text, kind), expected, false, clock.ElapsedMilliseconds));
            }
            if (kind == OcrDocumentKind.MechanicalWater)
            {
                var clock = Stopwatch.StartNew();
                var result = digits.Recognize(crop, default);
                observations.Add(new
                {
                    mode = "oracle_window_water_stage2",
                    proposed = result.Digits is not null,
                    exactDigits = result.Digits == expected,
                    incorrectDigits = result.Digits is not null && result.Digits != expected,
                    fallback = result.Digits is null,
                    result.Warnings,
                    elapsedMs = clock.ElapsedMilliseconds
                });
            }
            rows.Add(new
            {
                id = sample.GetProperty("id").GetString(),
                category = sample.GetProperty("category").GetString(),
                sha256 = sample.GetProperty("sha256").GetString(),
                sampleReview = sample.GetProperty("review").Clone(),
                inputTransform = "mobile-1600-jpeg85",
                expectedDigits = expected,
                decimalPlaces = (int?)null,
                billingAccuracy = (double?)null,
                fullFrameHasMultipleMeters = multiple,
                observations
            });
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
        {
            engine = OnnxOcrEngine.Version,
            manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifest))),
            thresholdSelectionPerformed = false,
            modelsActivated = false,
            independentHumanAcceptance = false,
            limitations = new[] { "Two agent-reviewed images; independent human label review pending.",
                "Oracle-window probes do not measure localization or full-frame reading accuracy.",
                "Exact digit sequences exclude decimal/register verification; billing accuracy NOT MEASURED.",
                "Multiple-meter full frame must reject a proposal, even if a selected oracle crop is readable." },
            rows
        }, OcrEvaluation.Json));
        Console.WriteLine($"Evaluated {rows.Count} public positive candidates; inspect evidence, exit0 is not an accuracy gate.");
        return 0;
    }

    private static object Observation(string mode, OcrProposal proposal, string expected, bool mustReject, long elapsed)
    {
        var value = proposal.ProposedFields.GetValueOrDefault("reading");
        var digitSequence = value?.Replace(".", "", StringComparison.Ordinal);
        return new
        {
            mode,
            proposed = value is not null,
            exactDigits = !mustReject && digitSequence == expected,
            incorrectDigits = !mustReject && value is not null && digitSequence != expected,
            expectedMultiMeterRejection = mustReject,
            unsafeMultiMeterProposal = mustReject && value is not null,
            fallback = value is null,
            proposal.Warnings,
            elapsedMs = elapsed
        };
    }

    private static Mat Window(Mat source, Point2f[] corners)
    {
        var width = Math.Max(2, (int)Math.Max(corners[0].DistanceTo(corners[1]), corners[2].DistanceTo(corners[3])));
        var height = Math.Max(2, (int)Math.Max(corners[0].DistanceTo(corners[3]), corners[1].DistanceTo(corners[2])));
        if (width < height) throw new InvalidDataException("Reviewed digit window must run left to right.");
        Point2f[] target = [new(0, 0), new(width - 1, 0), new(width - 1, height - 1), new(0, height - 1)];
        using var transform = Cv2.GetPerspectiveTransform(corners, target);
        var crop = new Mat();
        Cv2.WarpPerspective(source, crop, transform, new(width, height), InterpolationFlags.Linear, BorderTypes.Replicate);
        return crop;
    }
}
