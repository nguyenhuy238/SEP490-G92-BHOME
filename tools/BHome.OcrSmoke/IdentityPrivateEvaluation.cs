using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;

internal static class IdentityPrivateEvaluation
{
    // Read-only real-image evaluation. Never serialize filenames, image hashes,
    // text, field values, QR/MRZ payloads or exceptions from private input.
    public static async Task<int> Run(string models, string input, string report, string? reviewedSides = null)
    {
        var files = Directory.EnumerateFiles(input).Where(file => Path.GetExtension(file).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png")
            .Order(StringComparer.Ordinal).Take(65).ToArray();
        if (files.Length is 0 or > 64) throw new InvalidDataException("Private evaluation requires 1..64 images.");
        Dictionary<int, OcrDocumentKind>? sides = null;
        if (reviewedSides is not null)
        {
            using var review = JsonDocument.Parse(await File.ReadAllTextAsync(reviewedSides));
            sides = review.RootElement.GetProperty("results").EnumerateArray().ToDictionary(
                row => row.GetProperty("imageIndex").GetInt32(),
                row => row.GetProperty("profile").GetString() switch
                {
                    "IdentityFront" => OcrDocumentKind.IdentityFront,
                    "IdentityBack" => OcrDocumentKind.IdentityBack,
                    _ => throw new InvalidDataException("Unsupported reviewed side.")
                });
            if (sides.Count != files.Length || Enumerable.Range(0, files.Length).Any(index => !sides.ContainsKey(index)))
                throw new InvalidDataException("Reviewed sides must cover every local input exactly once.");
        }
        var options = new OcrOptions { Enabled = true, ModelDirectory = models };
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        var results = new List<object>();
        var times = new List<long>();
        for (var index = 0; index < files.Length; index++)
        {
            foreach (var side in sides is null ? new[] { OcrDocumentKind.IdentityFront, OcrDocumentKind.IdentityBack } : [sides[index]])
            {
                await using var stream = File.OpenRead(files[index]);
                var clock = Stopwatch.StartNew();
                var proposal = await service.ExtractAsync(stream, side, default);
                times.Add(clock.ElapsedMilliseconds);
                results.Add(new
                {
                    imageIndex = index,
                    profile = side.ToString(),
                    elapsedMilliseconds = times[^1],
                    fields = proposal.ProposedFields.Keys,
                    proposal.Confidence,
                    proposal.MissingFields,
                    proposal.Warnings,
                    proposal.IsFallback,
                    proposal.RequiresConfirmation
                });
            }
        }
        times.Sort();
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
        {
            dataset = "private-local",
            engineVersion = OnnxOcrEngine.Version,
            imageCount = files.Length,
            accuracyMeasured = false,
            sideAware = sides is not null,
            note = "Field presence is not correctness. Reviewed side selection does not transfer previous accuracy labels to this engine version. Device verification remains required.",
            p95Milliseconds = times[(int)Math.Ceiling(times.Count * .95) - 1],
            results
        }, OcrEvaluation.Json));
        Console.WriteLine(JsonSerializer.Serialize(new { dataset = "private-local", imageCount = files.Length, accuracyMeasured = false }));
        return 0;
    }
}
