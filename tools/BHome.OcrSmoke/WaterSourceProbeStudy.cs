using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;

// Full publisher input frames, no oracle regions or numeric labels in inference.
internal static class WaterSourceProbeStudy
{
    public static async Task<int> Run(string models, string yolo, string manifest, string root, string report)
    {
        using var input = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = models,
            MeterDetectionMinConfidence = .7f,
            MeterDetector = new() { Enabled = true, WaterDigitsEnabled = true, ModelDirectory = yolo }
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var baseline = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        var fullRow = new WaterFullRowCandidate(options, detector, digits, baseline);
        var geometry = new WaterDigitGeometryCandidate(options, detector, digits, baseline, fullRow);
        var rows = new List<object>();
        foreach (var sample in input.RootElement.GetProperty("samples").EnumerateArray())
        {
            var path = Path.GetFullPath(Path.Combine(root, sample.GetProperty("image").GetString()!));
            if (!path.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Outside source root.");
            var bytes = await File.ReadAllBytesAsync(path);
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(sample.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Source changed.");
            var observations = new List<object>();
            foreach (var (name, engine) in new (string, IOcrEngine)[] { ("baseline", baseline), ("full_row", fullRow), ("candidate", geometry) })
            {
                using var service = new LocalOcrService(options, new(() => engine), NullLogger<LocalOcrService>.Instance);
                using var stream = new MemoryStream(bytes);
                try
                {
                    var result = await service.ExtractAsync(stream, OcrDocumentKind.MechanicalWater, default);
                    var value = result.ProposedFields.GetValueOrDefault("reading");
                    var expected = sample.GetProperty("expectedDigits").GetString();
                    observations.Add(new
                    {
                        mode = name,
                        value,
                        inputRejected = false,
                        exact = expected is not null && value == expected,
                        wrongOnDraftCompleteLabel = expected is not null && value is not null && value != expected,
                        unresolvedProposal = expected is null && value is not null,
                        result.IsFallback,
                        result.Warnings
                    });
                }
                catch (OcrInputException)
                {
                    observations.Add(new
                    {
                        mode = name,
                        value = (string?)null,
                        inputRejected = true,
                        exact = false,
                        wrongOnDraftCompleteLabel = false,
                        unresolvedProposal = false,
                        IsFallback = true,
                        Warnings = new[] { "invalid_source_image_header" }
                    });
                }
            }
            rows.Add(new { id = sample.GetProperty("id").GetString(), observations });
            Array.Clear(bytes);
        }
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
        {
            scope = "provisional_source_partial_body_frames_not_independent_acceptance",
            registeredInApplication = false,
            manifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifest))),
            rows
        }, OcrEvaluation.Json));
        return 0;
    }
}
