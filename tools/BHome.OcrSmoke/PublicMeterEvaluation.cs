using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

// Caller-supplied licensed public development corpora only. Metrics are evidence,
// never acceptance tests or authority to register a candidate model in runtime.
internal static class PublicMeterEvaluation
{
    public static int Lcd(string models, string dataset, string report)
    {
        using var audit = JsonDocument.Parse(File.ReadAllText(Path.Combine(dataset, "audit.json")));
        if (audit.RootElement.GetProperty("task").GetString() != "lcd_digit_detection") throw new InvalidDataException();
        var options = new OcrOptions { ModelDirectory = models };
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        var rows = new List<object>();
        foreach (var sample in audit.RootElement.GetProperty("samples").EnumerateArray().Where(s => s.GetProperty("split").GetString() is "val" or "test"))
        {
            var expected = sample.GetProperty("expectedDigits").GetString();
            if (expected is not null && !Regex.IsMatch(expected, "^[0-9]{3,12}$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)))
                throw new InvalidDataException();
            var path = ImagePath(dataset, sample);
            using var image = Cv2.ImRead(path);
            foreach (var direct in new[] { true, false })
            {
                var timer = Stopwatch.StartNew();
                var text = engine.InspectMeterCrop(image, direct, default);
                var kind = sample.GetProperty("id").GetString() == "commons_141189268" ? OcrDocumentKind.DigitalWater : OcrDocumentKind.DigitalElectricity;
                var proposal = OcrFieldParser.Parse(text, kind);
                var value = proposal.ProposedFields.GetValueOrDefault("reading");
                var digits = value?.Replace(".", "", StringComparison.Ordinal).Replace(",", "", StringComparison.Ordinal);
                rows.Add(new
                {
                    id = sample.GetProperty("id").GetString(),
                    split = sample.GetProperty("split").GetString(),
                    variant = direct ? "pp_direct" : "pp_page",
                    expectedDigits = expected,
                    actualDigits = digits,
                    exact = expected is not null && expected == digits,
                    falseProposal = digits is not null && digits != expected,
                    fallback = digits is null,
                    elapsedMs = timer.ElapsedMilliseconds,
                    proposal.Warnings
                });
            }
        }
        File.WriteAllText(report, JsonSerializer.Serialize(new
        {
            engine = OnnxOcrEngine.Version,
            rows,
            limitation = "Reviewed display crops; digit sequence only, decimal/register eligibility excluded. No full-frame or billing accuracy claim."
        }, OcrEvaluation.Json));
        Console.WriteLine($"Public LCD baseline completed: {rows.Count} variant/image observations; inspect metrics, exit status is not an accuracy pass.");
        return 0;
    }

    public static async Task<int> Categories(string models, string yolo, string manifest, string images, string report)
    {
        using var data = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = models,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo },
            MeterDetectionMinConfidence = .7f
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        var rows = new List<object>();
        foreach (var sample in data.RootElement.GetProperty("samples").EnumerateArray().Where(s => s.GetProperty("split").GetString() == "test"))
        {
            var expected = sample.GetProperty("category").GetString();
            if (expected is not ("electricity_mechanical" or "electricity_digital" or "water_mechanical" or "water_digital" or "not_meter"))
                throw new InvalidDataException();
            using var input = File.OpenRead(ImagePath(images, sample));
            var timer = Stopwatch.StartNew();
            var result = await service.ExtractAutomaticAsync(input, default);
            rows.Add(new
            {
                id = sample.GetProperty("id").GetString(),
                expected,
                result.ClassificationStatus,
                result.DetectedCategory,
                result.ClassificationSource,
                result.ClassificationConfidence,
                correctCategory = result.ClassificationStatus == "classified" && result.DetectedCategory == expected,
                wrongCategory = result.ClassificationStatus == "classified" && result.DetectedCategory != expected,
                fallback = result.ClassificationStatus != "classified",
                result.Warnings,
                elapsedMs = timer.ElapsedMilliseconds
            });
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
        {
            engine = OnnxOcrEngine.Version,
            rows,
            limitation = "Small public agent-reviewed body-category development holdout; no exact-reading labels. Do not score numeric reading accuracy here."
        }, OcrEvaluation.Json));
        Console.WriteLine($"Public automatic baseline completed: {rows.Count} images; inspect metrics, exit status is not an accuracy pass.");
        return 0;
    }

    internal static string ImagePath(string directory, JsonElement sample)
    {
        var root = Path.GetFullPath(directory);
        var path = Path.GetFullPath(sample.GetProperty("image").GetString()!, root);
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            Path.GetExtension(path).ToLowerInvariant() is not (".jpg" or ".jpeg" or ".png")) throw new InvalidDataException();
        var info = new FileInfo(path);
        if (info.Length is <= 0 or > 5 * 1024 * 1024 || info.LinkTarget is not null) throw new InvalidDataException();
        using var input = File.OpenRead(path);
        if (!Convert.ToHexString(SHA256.HashData(input)).Equals(sample.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException();
        return path;
    }
}
