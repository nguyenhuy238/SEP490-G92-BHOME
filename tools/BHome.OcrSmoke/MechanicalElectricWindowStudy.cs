using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

// Offline domain-transfer study only. Oracle crops and draft labels cannot
// authorize classification, register choice, precision or a billing proposal.
internal static class MechanicalElectricWindowStudy
{
    public static async Task<int> RunAsync(string models, string yolo, string english,
        string manifest, string root, string report)
    {
        if (File.Exists(report)) throw new IOException("Use a fresh study output.");
        using var input = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions { ModelDirectory = models, MeterDetector = new() { ModelDirectory = yolo } };
        using var baseline = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var candidate = new EnglishMeterTextRecognizer(english);
        using var digits = new YoloWaterDigitRecognizer(options);
        var rows = new List<object>();
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var sample in input.RootElement.GetProperty("samples").EnumerateArray())
        {
            var path = Path.GetFullPath(Path.Combine(prefix, sample.GetProperty("crop").GetString()!));
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Crop outside root.");
            var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)));
            if (!hash.Equals(sample.GetProperty("cropSha256").GetString(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Frozen crop changed.");
            var expected = sample.GetProperty("expectedDigits").GetString();
            using var image = Cv2.ImRead(path);
            foreach (var mode in new[] { "baseline_direct", "baseline_page", "english_direct", "water_stage2_transfer" })
            {
                var timer = Stopwatch.StartNew();
                string? raw; float? confidence; IReadOnlyList<string> warnings = [];
                if (mode == "water_stage2_transfer")
                { var result = digits.Recognize(image, default); raw = result.Digits; confidence = result.Confidence; warnings = result.Warnings; }
                else if (mode == "english_direct")
                { var result = candidate.Recognize(image, default); raw = result.Line.Text; confidence = result.Line.Confidence; }
                else
                { var result = baseline.InspectMeterCrop(image, mode == "baseline_direct", default); raw = string.Join(" ", result.Lines.Select(x => x.Text)); confidence = result.Lines.Count == 0 ? 0 : result.Lines.Average(x => x.Confidence); }
                rows.Add(new { id = sample.GetProperty("id").GetString(), mode, expectedDigits = expected, raw, confidence,
                    draftMatch = expected is null ? (bool?)null : raw == expected, warnings, observedMs = timer.Elapsed.TotalMilliseconds });
            }
        }
        var modelHashes = new Dictionary<string, string>();
        foreach (var (name, path) in new[] { ("pp", Path.Combine(models, "recognition.onnx")),
            ("english", Path.Combine(english, "inference.onnx")), ("stage2", Path.Combine(yolo, "water-stage2.onnx")) })
            modelHashes[name] = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)));
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { scope = "provisional_oracle_development_no_billing_claim",
            runtimeEnabled = false, modelHashes, manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifest))), rows }, OcrEvaluation.Json));
        Console.WriteLine($"Mechanical electricity oracle study: {rows.Count} observations; no independent accuracy claim");
        return 0;
    }
}
