using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

internal static class WaterReaderComparison
{
    public static async Task<int> ParityAsync(string model, string crops, string referencePath, string report)
    {
        using var expected = JsonDocument.Parse(await File.ReadAllTextAsync(referencePath));
        using var reader = new EnglishMeterTextRecognizer(model);
        var rows = new List<object>(); var passed = true;
        foreach (var sample in expected.RootElement.GetProperty("rows").EnumerateArray())
        {
            var name = sample.GetProperty("file").GetString()!;
            if (name != Path.GetFileName(name)) throw new InvalidDataException("Invalid public parity filename.");
            var path = Path.Combine(crops, name);
            var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)));
            if (!hash.Equals(sample.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Parity image checksum mismatch.");
            using var image = Cv2.ImRead(path); var observed = reader.Recognize(image, default);
            var meanDelta = Math.Abs(observed.Line.Confidence - sample.GetProperty("confidence").GetSingle());
            var minimumDelta = Math.Abs(observed.MinimumCharacterScore - sample.GetProperty("minimumCharacterScore").GetSingle());
            var same = observed.Line.Text == sample.GetProperty("text").GetString() && meanDelta < .0002f && minimumDelta < .0002f;
            passed &= same; rows.Add(new { file = name, passed = same, meanDelta, minimumDelta });
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { passed, rows }, OcrEvaluation.Json));
        Console.WriteLine($"English Python/.NET parity: {passed}, {rows.Count} public crops"); return passed ? 0 : 1;
    }

    public static async Task<int> RunAsync(string models, string yolo, string english, string images, string manifestPath, string report,
        bool rowMarginStudy=false)
    {
        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(manifestPath))!;
        var options = new OcrOptions { Enabled = true, ModelDirectory = models, MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo } };
        using var detector = new YoloMeterSceneDetector(options); using var digits = new YoloWaterDigitRecognizer(options);
        using var candidate = new EnglishMeterTextRecognizer(english);
        using var baselineEngine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        IOcrEngine candidateEngine = rowMarginStudy ? new WaterRowMarginCandidate(options,detector,digits,baselineEngine) :
            new EnglishWaterCandidateEngine(options, detector, digits, baselineEngine, candidate);
        var strictEngine = new EnglishWaterCandidateEngine(options, detector, digits, baselineEngine, candidate, preserveAllNumericDisagreements: true);
        using var baselineService = new LocalOcrService(options, new(() => baselineEngine), NullLogger<LocalOcrService>.Instance);
        using var candidateService = new LocalOcrService(options, new(() => candidateEngine), NullLogger<LocalOcrService>.Instance);
        using var strictService = new LocalOcrService(options, new(() => strictEngine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>();
        foreach (var name in manifest.Keys.Where(k => k.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)).Order())
        {
            if (name != Path.GetFileName(name)) throw new InvalidDataException("Public fixture filename required.");
            foreach (var asset in new[] { name, Path.ChangeExtension(name, ".txt") })
                if (!manifest.TryGetValue(asset, out var hash) || !Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(images, asset)))).Equals(hash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Public fixture checksum mismatch.");
            var labels = File.ReadAllLines(Path.Combine(images, Path.ChangeExtension(name, ".txt"))).Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            var expected = string.Concat(labels.Where(l => int.Parse(l[0]) is >= 2 and < 12).OrderBy(l => Enumerable.Range(0, 4).Average(i => double.Parse(l[1 + 2 * i], System.Globalization.CultureInfo.InvariantCulture))).Select(l => int.Parse(l[0]) - 2));
            var complete = !labels.Any(l => l[0] == "12");
            using var original = Cv2.ImRead(Path.Combine(images, name)); using var resized = new Mat();
            var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height));
            Cv2.Resize(original, resized, new((int)(original.Width * scale), (int)(original.Height * scale)), 0, 0, InterpolationFlags.Area);
            var bytes = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
            var observations = new List<object>();
            var modes=rowMarginStudy ? new[] {("baseline",baselineService),("candidate",candidateService)} :
                new[] { ("baseline", baselineService), ("candidate", candidateService), ("preserve_all_numeric_disagreements", strictService) };
            foreach (var (mode, service) in modes)
            {
                using var input = new MemoryStream(bytes); var timer = Stopwatch.StartNew();
                var result = await service.ExtractAsync(input, OcrDocumentKind.MechanicalWater, default);
                var value = result.ProposedFields.GetValueOrDefault("reading");
                observations.Add(new { mode, value, exact = complete && value == expected,
                    incorrectOnCompleteLabels = complete && value is not null && value != expected,
                    unknownGroundTruthProposal = !complete && value is not null, result.IsFallback, result.Warnings,
                    result.EngineVersion, elapsedMs = timer.ElapsedMilliseconds });
            }
            rows.Add(new { imageId = name, sha256 = manifest[name], expectedDigits = complete ? expected : null, observations });
            Array.Clear(bytes); Console.WriteLine($"Compared water reader {rows.Count}");
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { minimumEnglishCharacterScore = .95,rowMarginStudy,
            selection = "frozen_on_historical_validation_only", registeredInApplication = false,
            englishModelSha256 = EnglishMeterTextRecognizer.ModelSha256,
            manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath))), rows }, OcrEvaluation.Json));
        return 0;
    }
}

// Offline-only physical row-margin hypothesis. Never registered in application DI.
internal sealed class WaterRowMarginCandidate(OcrOptions options,YoloMeterSceneDetector detector,
    YoloWaterDigitRecognizer digits,OnnxOcrEngine baseline) : IOcrEngine
{
    public async Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image,OcrDocumentKind kind,CancellationToken token)
    {
        var original=await baseline.RecognizeAsync(image,kind,token);
        if(kind!=OcrDocumentKind.MechanicalWater || !OcrFieldParser.Parse(original,kind).IsFallback ||
            original.Warnings.Any(w=>w is "recognizer_conflict" or "conflicting_reading" or "unclear_digit" or "orientation_uncertain" or "text_region_limit")) return original;
        using var prepared=new ImagePreprocessor(options).Prepare(image,kind);
        if(prepared.Warnings.Contains("blur_or_low_detail")) return original;
        var selection=MeterSceneSelection.Select(detector.Detect(prepared.Image,token),prepared.Image.Size(),kind,.7f);
        if(!selection.CanRecognize || selection.OrientedCrop is not {} pose || selection.Warnings.Contains("reading_region_unverified")) return original;
        var shortSide=Math.Min(pose.Size.Width,pose.Size.Height);
        var expanded=new RotatedRect(pose.Center,pose.Size.Width>=pose.Size.Height ?
            new Size2f(pose.Size.Width+shortSide*.5f,pose.Size.Height):new Size2f(pose.Size.Width,pose.Size.Height+shortSide*.5f),pose.Angle);
        if(expanded.Points().Any(p=>p.X<0||p.Y<0||p.X>=prepared.Image.Width||p.Y>=prepared.Image.Height)) return original;
        using var oldCrop=OnnxOcrEngine.Crop(prepared.Image,pose);
        var previousDigits=digits.Recognize(oldCrop,token);
        if(previousDigits.Warnings.Contains("unclear_digit")) return original;
        using var crop=OnnxOcrEngine.Crop(prepared.Image,expanded);
        var recognized=digits.Recognize(crop,token);
        if(previousDigits.Digits is {} old && old!=recognized.Digits) return original;
        var previousPp=OcrFieldParser.Parse(baseline.InspectMeterCrop(oldCrop,false,token),kind).ProposedFields.GetValueOrDefault("reading");
        if(previousPp is not null && previousPp.Replace(".","",StringComparison.Ordinal)!=recognized.Digits) return original;
        var pp=baseline.InspectMeterCrop(crop,false,token);
        pp=pp with {Warnings=[..prepared.Warnings,..selection.Warnings,..pp.Warnings,"offline_row_margin_probe"]};
        return MeterRecognitionFusion.Combine(pp,recognized);
    }
}

// Rejected model-routing experiment, deliberately outside application runtime.
internal sealed class EnglishWaterCandidateEngine(OcrOptions options, YoloMeterSceneDetector detector,
    YoloWaterDigitRecognizer digits, OnnxOcrEngine baseline, EnglishMeterTextRecognizer english,
    bool preserveAllNumericDisagreements = false) : IOcrEngine
{
    public async Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
    {
        var original = await baseline.RecognizeAsync(image, kind, token);
        if (kind != OcrDocumentKind.MechanicalWater) return original;
        using var prepared = new ImagePreprocessor(options).Prepare(image, kind);
        var selection = MeterSceneSelection.Select(detector.Detect(prepared.Image, token), prepared.Image.Size(), kind, .7f);
        if (!selection.CanRecognize || selection.OrientedCrop is not { } pose || selection.Warnings.Contains("reading_region_unverified")) return original;
        using var crop = OnnxOcrEngine.Crop(prepared.Image, pose);
        var pp = baseline.InspectMeterCrop(crop, false, token);
        pp = pp with { Warnings = [.. prepared.Warnings, .. selection.Warnings, .. pp.Warnings] };
        var alternate = english.Recognize(crop, token);
        if (alternate.MinimumCharacterScore < .95f || alternate.Line.Text.Length == 0 || !alternate.Line.Text.All(c => c is >= '0' and <= '9')) return original;
        var context = OcrFieldParser.Parse(pp, kind);
        if (context.Warnings.Any(w => w is "meter_type_mismatch" or "billing_register_unverified" or "multiple_reading_regions")) return original;
        if (preserveAllNumericDisagreements && context.ProposedFields.TryGetValue("reading", out var previous) &&
            previous.Replace(".", "", StringComparison.Ordinal) != alternate.Line.Text)
            return new([], OnnxOcrEngine.Version + "-en5-strict95", [.. pp.Warnings, "recognizer_conflict"]);
        var replacement = new OcrText([alternate.Line], OnnxOcrEngine.Version + "-en5-candidate95", [.. pp.Warnings, "english_meter_candidate"]);
        return MeterRecognitionFusion.Combine(replacement, digits.Recognize(crop, token));
    }
}
