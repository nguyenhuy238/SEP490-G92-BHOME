using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

// Crop-level diagnostic only. Neither output is a billing proposal.
internal static class ReviewedWindowComparison
{
    public static async Task<int> RunAsync(string models, string english, string manifest, string root, string report)
    {
        using var input = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions { ModelDirectory = models };
        using var baseline = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var candidate = new EnglishMeterTextRecognizer(english);
        var rows = new List<object>();
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var sample in input.RootElement.GetProperty("samples").EnumerateArray())
        {
            var path = Path.GetFullPath(Path.Combine(prefix, sample.GetProperty("crop").GetString()!));
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Crop outside evaluation root.");
            var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)));
            if (!hash.Equals(sample.GetProperty("cropSha256").GetString(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Reviewed crop checksum mismatch.");
            var expected = sample.GetProperty("expectedDigits").GetString()!;
            using var image = Cv2.ImRead(path);
            foreach (var mode in new[] { "baseline_direct", "baseline_page", "english_direct" })
            {
                var timer = Stopwatch.StartNew();
                string raw; float confidence;
                if (mode == "english_direct") { var result = candidate.Recognize(image, default); raw = result.Line.Text; confidence = result.Line.Confidence; }
                else { var result = baseline.InspectMeterCrop(image, mode == "baseline_direct", default); raw = string.Join(" ", result.Lines.Select(x => x.Text)); confidence = result.Lines.Count == 0 ? 0 : result.Lines.Average(x => x.Confidence); }
                rows.Add(new
                {
                    id = sample.GetProperty("id").GetString(),
                    mode,
                    expectedDigits = expected,
                    raw,
                    confidence,
                    exactRaw = raw == expected,
                    observedMs = timer.Elapsed.TotalMilliseconds
                });
            }
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { scope = "agent_reviewed_development_oracle_crops_no_billing_claim", rows }, OcrEvaluation.Json));
        Console.WriteLine($"Reviewed crop comparison: {rows.Count} observations");
        return 0;
    }
}
