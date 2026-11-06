using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// One detector + recognizer per process. No network, file writes or image logging.
public sealed class OnnxOcrEngine : IOcrEngine, IOcrAnalysisEngine, IDisposable
{
    public const string Version = "ocrdoc-ppocrv6-vi-run6-9b534643-yolo2-cache1";
    private readonly OcrOptions options;
    private readonly IImagePreprocessor preprocessor;
    private readonly InferenceSession detector;
    private readonly InferenceSession recognizer;
    private readonly string[] dictionary;
    private readonly IMeterSceneDetector? meterDetector;
    private readonly IImageCategoryClassifier? categoryClassifier;
    private readonly YoloWaterDigitRecognizer? waterDigits;

    public OnnxOcrEngine(OcrOptions options, IImagePreprocessor preprocessor, IMeterSceneDetector? meterDetector = null,
        IImageCategoryClassifier? categoryClassifier = null, YoloWaterDigitRecognizer? waterDigits = null)
    {
        this.options = options;
        this.preprocessor = preprocessor;
        this.meterDetector = meterDetector;
        this.categoryClassifier = categoryClassifier;
        this.waterDigits = waterDigits;
        VerifyFile("detection.onnx", "eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1");
        VerifyFile("recognition.onnx", "767305d37d06728fe9578ff8132595ce23f66139df5e2937fd4131bd1dc34f12");
        VerifyFile("charset.txt", "5d801bf60472c4c1b184b6b6843aa2c754d8daf1429247e07658ee0bd79ab448");
        dictionary = ["", .. File.ReadAllLines(Path.Combine(options.ModelDirectory, "charset.txt"), Encoding.UTF8), " "];
        using var sessionOptions = new SessionOptions
        {
            IntraOpNumThreads = options.InferenceThreads,
            InterOpNumThreads = 1,
            GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
            LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL
        };
        detector = new InferenceSession(Path.Combine(options.ModelDirectory, "detection.onnx"), sessionOptions);
        try
        {
            recognizer = new InferenceSession(Path.Combine(options.ModelDirectory, "recognition.onnx"), sessionOptions);
            if (detector.InputMetadata.Count != 1 || recognizer.InputMetadata.Count != 1 ||
                detector.InputMetadata.First().Value.Dimensions.Length != 4 || recognizer.InputMetadata.First().Value.Dimensions.Length != 4)
                throw new InvalidDataException("Unsupported OCR model contract.");
        }
        catch { detector.Dispose(); recognizer?.Dispose(); throw; }
    }

    private void VerifyFile(string name, string expected)
    {
        using var stream = File.OpenRead(Path.Combine(options.ModelDirectory, name));
        if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("OCR model checksum mismatch.");
    }

    public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken cancellationToken)
        => Task.Run(() => Recognize(image, kind, cancellationToken), cancellationToken);

    public Task<OcrImageAnalysis> AnalyzeAsync(ReadOnlyMemory<byte> image, CancellationToken token) =>
        Task.Run(() => Analyze(image, token), token);

    private OcrImageAnalysis Analyze(ReadOnlyMemory<byte> image, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var prepared = preprocessor.PrepareUnclassified(image);
        using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        using var registration = token.Register(() => run.Terminate = true);
        using var localized = new Mat();
        using var upright = new Mat();
        using var reversed = new Mat();
        var clock = Stopwatch.StartNew();
        try
        {
            var source = prepared.Image;
            var visual = categoryClassifier?.Classify(source, token);
            OcrDocumentKind? kind = null;
            var warnings = prepared.Warnings.ToList();
            if (visual is not null)
            {
                if (visual.Status != "classified" || visual.Candidates is { Count: > 1 } ||
                    (visual.Warnings ?? []).Any(w => w is "multiple_meters" or "ambiguous_reading" or "multiple_reading_regions") ||
                    visual.Kind is null || !Enum.IsDefined(visual.Kind.Value) ||
                    visual.Confidence is not { } confidence || !float.IsFinite(confidence) ||
                    confidence < options.AutomaticClassificationMinConfidence || confidence > 1)
                    return new(new([], Version, warnings), visual);
                kind = visual.Kind;
                if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
                {
                    var selection = MeterSceneSelection.Select(meterDetector is not null && meterDetector.Supports(kind.Value) ? meterDetector.Detect(source, token) : null, source.Size(),
                        kind.Value, options.MeterDetectionMinConfidence);
                    warnings.AddRange(selection.Warnings);
                    if (!selection.CanRecognize)
                        return new(new([], Version, warnings), visual with { Status = "ambiguous", Kind = null });
                    if (selection.Crop is { } rect)
                    {
                        if (selection.OrientedCrop is { } oriented) { using var crop = Crop(source, oriented); crop.CopyTo(localized); }
                        else { using var roi = new Mat(source, rect); roi.CopyTo(localized); }
                        source = localized;
                    }
                }
            }
            var regions = Detect(source, run, token);
            if (OcrImageGeometry.IsVertical(regions))
            {
                Cv2.Rotate(source, upright, RotateFlags.Rotate90Counterclockwise);
                source = upright; regions = Detect(source, run, token);
                warnings.Add("orientation_corrected");
            }
            var recognizedLines = new Dictionary<RotatedRect, OcrLine>();
            var text = ReadPage(source, regions, kind, run, token, recognizedLines);
            // Only unresolved neutral text gets an opposite-direction attempt. We
            // never run all six OCR pipelines or let a flip erase ambiguous evidence.
            if (visual is null && OcrCategoryRules.Evaluate(text).Status == "unknown" &&
                regions.Count > 0 && !text.Warnings.Contains("text_region_limit") &&
                clock.ElapsedMilliseconds < options.TimeoutMilliseconds / 2)
            {
                Cv2.Rotate(source, reversed, RotateFlags.Rotate180);
                var alternativeRegions = Detect(reversed, run, token);
                // A different image/orientation must have a separate recognition cache.
                var alternativeLines = new Dictionary<RotatedRect, OcrLine>();
                var alternative = ReadPage(reversed, alternativeRegions, null, run, token, alternativeLines);
                if (OcrCategoryRules.Evaluate(alternative).Status != "unknown")
                {
                    text = alternative;
                    source = reversed;
                    regions = alternativeRegions;
                    recognizedLines = alternativeLines;
                    warnings.Add("orientation_corrected");
                }
            }
            token.ThrowIfCancellationRequested();
            var fullText = text with { Warnings = [.. warnings, .. text.Warnings] };
            var categoryEvidence = OcrCategoryRules.Evaluate(fullText);
            // A water-domain model must not be applied to an explicitly identified
            // electricity or digital-water device. Its typed PP path remains available.
            if (visual is null && categoryEvidence.Kind is OcrDocumentKind.DigitalElectricity or OcrDocumentKind.MechanicalElectricity or OcrDocumentKind.DigitalWater)
            {
                // Reuse the already detected boxes with the now-supported meter
                // profile (numeric/unit refinement), rather than running six OCR
                // profiles or feeding an electricity image to a water model.
                var profiled = ReadPage(source, regions, categoryEvidence.Kind, run, token, recognizedLines);
                return new(profiled with { Warnings = [.. fullText.Warnings, .. profiled.Warnings] });
            }
            if (visual is null && meterDetector is not null)
            {
                var scene = meterDetector.Detect(prepared.Image, token);
                if (!scene.IsAvailable && scene.Warnings.Count > 0)
                    fullText = fullText with { Warnings = [.. fullText.Warnings, .. scene.Warnings] };
                if (scene.IsAvailable && (scene.Meters.Count > 0 || scene.StandaloneReadingRegions.Count > 0))
                {
                    var rules = OcrCategoryRules.Evaluate(fullText);
                    if (rules.Kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack ||
                        (rules.Candidates ?? []).Any(k => k is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
                        return new(fullText, new("ambiguous", null, "yolo_reading_region", Warnings: ["classification_conflict"]));
                    var selection = MeterSceneSelection.Select(scene, prepared.Image.Size(), null, options.MeterDetectionMinConfidence);
                    if (!selection.CanRecognize || selection.Crop is null)
                        return new(fullText, new("ambiguous", null, "yolo_reading_region", Warnings: selection.Warnings));
                    using var roi = new Mat(prepared.Image, selection.Crop.Value);
                    using var reading = selection.OrientedCrop is { } oriented ? Crop(prepared.Image, oriented) : roi.Clone();
                    try
                    {
                        var croppedText = ReadPage(reading, Detect(reading, run, token), null, run, token);
                        if (croppedText.Lines.Count == 0)
                            croppedText = new([ReadLine(reading, run, wideLine: true)], Version, []);
                        var knownWater = rules.Kind == OcrDocumentKind.MechanicalWater ||
                            rules.Candidates is { Count: > 0 } choices && choices.All(k => k is OcrDocumentKind.MechanicalWater or OcrDocumentKind.DigitalWater);
                        if (knownWater && options.MeterDetector.WaterDigitsEnabled && waterDigits is not null)
                            croppedText = MeterRecognitionFusion.Combine(croppedText, waterDigits.Recognize(reading, token));
                        else if (options.MeterDetector.WaterDigitsEnabled)
                            croppedText = new([], Version, [.. croppedText.Warnings, "recognizer_profile_required"]);
                        croppedText = croppedText with { Warnings = [.. selection.Warnings, .. croppedText.Warnings] };
                        using var preview = new Mat();
                        var previewRatio = Math.Min(1d, 480d / reading.Width);
                        Cv2.Resize(reading, preview, new Size(Math.Max(1, (int)(reading.Width * previewRatio)), Math.Max(1, (int)(reading.Height * previewRatio))));
                        var encoded = preview.ImEncode(".jpg");
                        try
                        {
                            var score = scene.Meters.SelectMany(m => m.ReadingRegions ?? []).Concat(scene.StandaloneReadingRegions).Single().Confidence;
                            return new(fullText, MeterRegion: new(croppedText, score, "data:image/jpeg;base64," + Convert.ToBase64String(encoded)));
                        }
                        finally { CryptographicOperations.ZeroMemory(encoded); preview.SetTo(Scalar.All(0)); }
                    }
                    finally { reading.SetTo(Scalar.All(0)); }
                }
            }
            return new(fullText, visual);
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
        finally
        {
            // Automatic input may be a CCCD even when classified as unknown/meter.
            foreach (var temporary in new[] { localized, upright, reversed })
                if (!temporary.Empty()) temporary.SetTo(Scalar.All(0));
        }
    }

    private OcrText Recognize(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var prepared = preprocessor.Prepare(image, kind);
        using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        using var registration = token.Register(() => run.Terminate = true);
        var clock = Stopwatch.StartNew();
        try
        {
            using var upright = new Mat();
            using var reversed = new Mat();
            using var localized = new Mat();
            var source = prepared.Image;
            IReadOnlyList<string> localizationWarnings = [];
            if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
            {
                var selection = MeterSceneSelection.Select(meterDetector is not null && meterDetector.Supports(kind) ? meterDetector.Detect(source, token) : null, source.Size(),
                    kind, options.MeterDetectionMinConfidence);
                localizationWarnings = selection.Warnings;
                if (!selection.CanRecognize)
                    return new OcrText([], Version, [.. prepared.Warnings, .. localizationWarnings]);
                if (selection.Crop is { } rect)
                {
                    if (selection.OrientedCrop is { } oriented) { using var crop = Crop(source, oriented); crop.CopyTo(localized); }
                    else { using var roi = new Mat(source, rect); roi.CopyTo(localized); }
                    source = localized;
                    if (kind == OcrDocumentKind.MechanicalWater && options.MeterDetector.WaterDigitsEnabled && waterDigits is not null)
                    {
                        var cropped = ReadPage(source, Detect(source, run, token), null, run, token);
                        cropped = cropped with { Warnings = [.. prepared.Warnings, .. localizationWarnings, .. cropped.Warnings] };
                        var fused = MeterRecognitionFusion.Combine(cropped, waterDigits.Recognize(source, token));
                        return fused;
                    }
                }
            }
            token.ThrowIfCancellationRequested();
            var regions = Detect(source, run, token);
            var axisCorrected = OcrImageGeometry.IsVertical(regions);
            if (axisCorrected)
            {
                Cv2.Rotate(source, upright, RotateFlags.Rotate90Counterclockwise);
                source = upright;
                regions = Detect(source, run, token);
            }
            var text = ReadPage(source, regions, kind, run, token);
            var proposal = OcrFieldParser.Parse(text, kind);
            // Try the opposite direction only when the first result is missing data, leaving
            // budget for the request deadline. Detect again in the upright image: DBNet's
            // shrunken regions are not invariant under a 180-degree flip.
            if (!text.Warnings.Contains("conflicting_reading") &&
                (kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack ||
                    !proposal.Warnings.Any(warning => warning is "multiple_reading_regions" or "text_region_limit")) &&
                (proposal.IsFallback || proposal.MissingFields.Count > 0) && regions.Count > 0 &&
                clock.ElapsedMilliseconds < options.TimeoutMilliseconds / 2)
            {
                Cv2.Rotate(source, reversed, RotateFlags.Rotate180);
                var flipped = Detect(reversed, run, token);
                var alternative = ReadPage(reversed, flipped, kind, run, token);
                var alternativeProposal = OcrFieldParser.Parse(alternative, kind);
                var conflicting = proposal.ProposedFields.Any(field => alternativeProposal.ProposedFields.TryGetValue(field.Key, out var value) && value != field.Value);
                if (!conflicting && alternativeProposal.ProposedFields.Count > proposal.ProposedFields.Count)
                    text = alternative with { Warnings = [.. alternative.Warnings, "orientation_corrected"] };
                else if (conflicting && !alternativeProposal.IsFallback)
                    text = text with { Warnings = [.. text.Warnings, "orientation_uncertain"] };
            }
            token.ThrowIfCancellationRequested();
            return text with
            {
                Warnings = [.. prepared.Warnings, .. localizationWarnings, .. text.Warnings,
                .. kind is OcrDocumentKind.DigitalElectricity or OcrDocumentKind.DigitalWater
                    ? new[] { "billing_register_unverified" } : Array.Empty<string>(),
                .. axisCorrected ? new[] { "orientation_corrected" } : Array.Empty<string>()]
            };
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
    }

    private OcrText ReadPage(Mat source, List<RotatedRect> regions, OcrDocumentKind? kind, RunOptions run, CancellationToken token,
        Dictionary<RotatedRect, OcrLine>? recognizedLines = null)
    {
        var lines = new List<OcrLine>();
        var warnings = new List<string>();
        var lineRegions = new List<RotatedRect>();
        var pageAngle = OcrImageGeometry.PageAngle(regions);
        var meterRetries = 0;
        var meter = kind is OcrDocumentKind.MechanicalElectricity or OcrDocumentKind.DigitalElectricity or
            OcrDocumentKind.MechanicalWater or OcrDocumentKind.DigitalWater;
        var profile = kind.GetValueOrDefault(); // used only inside a known-meter branch
        if (regions.Count > options.MaxTextRegions) warnings.Add("text_region_limit");
        foreach (var region in regions.Take(options.MaxTextRegions))
        {
            token.ThrowIfCancellationRequested();
            using var crop = Crop(source, region);
            // Neutral and meter passes have identical recognizer input for the 320 bucket.
            // Wider neutral text may use 640 or word splitting, so it must be reread.
            // Meter-specific numeric splitting/refinement/conflict checks still run below.
            var line = recognizedLines is not null && recognizedLines.TryGetValue(region, out var cached) &&
                Math.Ceiling(48d * crop.Width / crop.Height) <= 320
                ? cached : ReadLine(crop, run, wideLine: !meter);
            recognizedLines?.TryAdd(region, line);
            // Read the number and its unit separately when a display's whitespace gives a
            // clear boundary. Identity-tuned CTC can otherwise swallow m³ into the digits.
            if (meter &&
                line.Text.Count(char.IsDigit) >= 4 && meterRetries < 4 &&
                MeterDisplaySplitter.TrySplit(crop, out var split))
            {
                meterRetries++;
                using var numberCrop = new Mat(crop, new Rect(0, 0, split, crop.Height));
                using var unitCrop = new Mat(crop, new Rect(split, 0, crop.Width - split, crop.Height));
                using var preparedNumber = MeterDisplaySplitter.PrepareSegment(numberCrop);
                using var preparedUnit = MeterDisplaySplitter.PrepareSegment(unitCrop);
                var number = ReadLine(preparedNumber, run);
                var unit = ReadLine(preparedUnit, run);
                var combined = new OcrText([new($"{number.Text} {unit.Text}", Math.Min(number.Confidence, unit.Confidence))], Version, []);
                if (MeterOcrLayout.IsCorrectUnit(unit.Text, profile) &&
                    OcrFieldParser.Parse(combined, profile).ProposedFields.ContainsKey("reading"))
                    line = combined.Lines[0];
            }
            if (line.Text.Length > 0)
            {
                lines.Add(line with { Bounds = OcrImageGeometry.LayoutBounds(region, pageAngle) });
                lineRegions.Add(region);
            }
        }
        if (meter)
        {
            var refinements = 0;
            for (var index = 0; index < lines.Count && refinements < 4; index++)
            {
                var line = lines[index];
                if (line.Text.Count(char.IsDigit) < 3 || !OcrNumericRefinement.HasUnit(line, lines, profile)) continue;
                if (kind is OcrDocumentKind.MechanicalElectricity or OcrDocumentKind.MechanicalWater &&
                    OcrNumericRefinement.HasReading(line, profile)) continue;
                token.ThrowIfCancellationRequested();
                refinements++;
                using var crop = Crop(source, lineRegions[index]);
                using var binary = OcrNumericRefinement.Binarize(crop);
                var candidate = ReadLine(binary, run);
                var result = OcrNumericRefinement.Select(line, candidate, profile);
                if (result.Conflicting) warnings.Add("conflicting_reading");
                else if (result.Changed) warnings.Add("reading_preprocessed");
                lines[index] = result.Line;
            }
        }
        token.ThrowIfCancellationRequested();
        if (lines.Count == 0) warnings.Add("no_text");
        return new OcrText(lines.OrderBy(line => Math.Round((line.Bounds!.Y + line.Bounds.Height / 2) / 12))
            .ThenBy(line => line.Bounds!.X).ToArray(), Version, warnings);
    }

    private List<RotatedRect> Detect(Mat image, RunOptions run, CancellationToken token)
    {
        var ratio = Math.Min(1d, 960d / Math.Max(image.Width, image.Height));
        var width = Math.Max(32, (int)Math.Round(image.Width * ratio / 32) * 32);
        var height = Math.Max(32, (int)Math.Round(image.Height * ratio / 32) * 32);
        using var resized = new Mat();
        Cv2.Resize(image, resized, new Size(width, height));
        var input = Tensor(resized, width, height, detection: true);
        using var output = detector.Run([NamedOnnxValue.CreateFromTensor(detector.InputNames[0], input)], detector.OutputNames, run);
        var map = output.First().AsTensor<float>();
        if (map.Rank != 4 || map.Dimensions[0] != 1 || map.Dimensions[1] != 1)
            throw new InvalidDataException("Unsupported detector output.");
        var mh = map.Dimensions[2]; var mw = map.Dimensions[3];
        using var mask = new Mat(mh, mw, MatType.CV_8UC1);
        for (var y = 0; y < mh; y++)
        {
            token.ThrowIfCancellationRequested();
            for (var x = 0; x < mw; x++) mask.Set(y, x, map[0, 0, y, x] > .3f ? (byte)255 : (byte)0);
        }
        Cv2.FindContours(mask, out Point[][] contours, out _, RetrievalModes.List, ContourApproximationModes.ApproxSimple);
        var boxes = new List<RotatedRect>();
        foreach (var contour in contours.OrderByDescending(c => Math.Abs(Cv2.ContourArea(c))).Take(256))
        {
            token.ThrowIfCancellationRequested();
            if (contour.Length < 3 || Math.Abs(Cv2.ContourArea(contour)) < 6) continue;
            var rect = Cv2.BoundingRect(contour);
            var sum = 0d; var count = 0;
            for (var y = rect.Top; y < rect.Bottom; y++)
                for (var x = rect.Left; x < rect.Right; x++)
                    if (mask.At<byte>(y, x) != 0) { sum += map[0, 0, y, x]; count++; }
            if (count == 0 || sum / count < .5) continue;
            var box = Cv2.MinAreaRect(contour.Select(p => new Point2f((float)p.X * image.Width / mw, (float)p.Y * image.Height / mh)));
            boxes.Add(OcrImageGeometry.Expand(box));
        }
        return boxes.OrderBy(b => Math.Round(b.Center.Y / 12)).ThenBy(b => b.Center.X).ToList();
    }

    internal static Mat Crop(Mat source, RotatedRect region)
    {
        // Order corners TL/TR/BR/BL, correct local text-line perspective/rotation.
        var src = OcrImageGeometry.Corners(region);
        var width = Math.Max(2, (int)Math.Max(src[0].DistanceTo(src[1]), src[2].DistanceTo(src[3])));
        var height = Math.Max(2, (int)Math.Max(src[0].DistanceTo(src[3]), src[1].DistanceTo(src[2])));
        Point2f[] dst = [new(0, 0), new(width - 1, 0), new(width - 1, height - 1), new(0, height - 1)];
        using var transform = Cv2.GetPerspectiveTransform(src, dst);
        var result = new Mat();
        Cv2.WarpPerspective(source, result, transform, new Size(width, height), InterpolationFlags.Linear,
            BorderTypes.Replicate);
        return result;
    }

    // Offline diagnostics consume only caller-supplied public/synthetic data. No
    // API endpoint, logging or persistence is attached to this method.
    internal OcrText InspectMeterCrop(Mat crop, bool direct, CancellationToken token)
    {
        using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        using var registration = token.Register(() => run.Terminate = true);
        return direct ? new([ReadLine(crop, run, true)], Version, []) : ReadPage(crop, Detect(crop, run, token), null, run, token);
    }

    private OcrLine ReadLine(Mat crop, RunOptions run, bool wideLine = false, int tileDepth = 0)
    {
        const int height = 48;
        // The pinned recognizer supports its trained 320/640 buckets. Compressing every long
        // bilingual label or MRZ line into 320 destroys characters even in a sharp photograph.
        var naturalWidth = (int)Math.Ceiling(height * crop.Width / (double)crop.Height);
        // Bilingual identity labels + long values can still exceed the model's 640 bucket.
        // Split only at observed whitespace, never inside digits or by a guessed name/date.
        if (wideLine && naturalWidth > 640 && tileDepth < 2 && OcrLineSegmentation.TryWordBoundary(crop, out var split))
        {
            using var left = new Mat(crop, new Rect(0, 0, split, crop.Height));
            using var right = new Mat(crop, new Rect(split, 0, crop.Width - split, crop.Height));
            var first = ReadLine(left, run, true, tileDepth + 1);
            var second = ReadLine(right, run, true, tileDepth + 1);
            return new($"{first.Text} {second.Text}".Trim(), Math.Min(first.Confidence, second.Confidence));
        }
        var width = wideLine && naturalWidth > 320 ? 640 : 320;
        var actualWidth = Math.Clamp(naturalWidth, 1, width);
        using var resized = new Mat();
        Cv2.Resize(crop, resized, new Size(actualWidth, height));
        using var padded = new Mat(height, width, MatType.CV_8UC3, Scalar.All(127));
        using (var roi = new Mat(padded, new Rect(0, 0, actualWidth, height))) resized.CopyTo(roi);
        var input = Tensor(padded, width, height, detection: false);
        using var output = recognizer.Run([NamedOnnxValue.CreateFromTensor(recognizer.InputNames[0], input)], recognizer.OutputNames, run);
        var scores = output.First().AsTensor<float>();
        if (scores.Rank != 3 || scores.Dimensions[0] != 1 || scores.Dimensions[2] != dictionary.Length)
            throw new InvalidDataException("Recognizer dictionary contract mismatch.");
        var text = new StringBuilder(); var confidence = 0f; var count = 0; var last = 0;
        for (var step = 0; step < scores.Dimensions[1]; step++)
        {
            var best = 0;
            for (var c = 1; c < dictionary.Length; c++) if (scores[0, step, c] > scores[0, step, best]) best = c;
            if (best != 0 && best != last)
            { text.Append(dictionary[best]); confidence += scores[0, step, best]; count++; }
            last = best;
        }
        return new(text.ToString().Trim(), count == 0 ? 0 : Math.Clamp(confidence / count, 0, 1));
    }

    private static DenseTensor<float> Tensor(Mat image, int width, int height, bool detection)
    {
        var data = new DenseTensor<float>(new[] { 1, 3, height, width });
        float[] means = [.485f, .456f, .406f]; float[] std = [.229f, .224f, .225f];
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var pixel = image.At<Vec3b>(y, x);
                for (var c = 0; c < 3; c++)
                {
                    // Detector uses RGB/ImageNet; recognizer uses Paddle's BGR [-1,1].
                    var value = pixel[detection ? 2 - c : c] / 255f;
                    data[0, c, y, x] = detection ? (value - means[c]) / std[c] : (value - .5f) / .5f;
                }
            }
        return data;
    }

    public void Dispose() { detector.Dispose(); recognizer.Dispose(); }
}
