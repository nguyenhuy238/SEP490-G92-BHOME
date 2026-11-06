using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

// Offline real-adapter benchmark. Loading a candidate here never enables HTTP
// inference or approves weights for Development/Production configuration.
internal static class VisualCategoryEvaluation
{
    public static int Run(string export, string dataset, string report)
    {
        using var metadata = JsonDocument.Parse(File.ReadAllText(Path.Combine(export, "evaluation.json")));
        using var audit = JsonDocument.Parse(File.ReadAllText(Path.Combine(dataset, "audit.json")));
        var expected = YoloMeterCategoryClassifier.Categories.Select(OcrCategories.Name).ToArray();
        if (!audit.RootElement.GetProperty("classes").EnumerateArray().Select(c => c.GetString()).SequenceEqual(expected) ||
            !metadata.RootElement.GetProperty("classes").EnumerateArray().Select(c => c.GetString()).SequenceEqual(expected))
            throw new InvalidDataException("Exactly four trained classes required.");
        var options = new OcrOptions { VisualClassifier = new() { Enabled = true,
            ModelPath = Path.Combine(export, "body.onnx"), Sha256 = metadata.RootElement.GetProperty("onnxSha256").GetString()! } };
        using var classifier = new YoloMeterCategoryClassifier(options, development: true);
        classifier.Warmup(default);
        var rows = new List<Row>();
        // Both thresholds are the existing adapter defaults, fixed before this
        // benchmark. Do not optimize them on the held-out test rows below.
        foreach (var split in new[] { "val", "test" })
        {
            foreach (var sample in audit.RootElement.GetProperty("samples").EnumerateArray().Where(s => s.GetProperty("split").GetString() == split))
            {
                using var image = Cv2.ImRead(PublicMeterEvaluation.ImagePath(dataset, sample));
                if (image.Empty()) throw new InvalidDataException("Invalid benchmark image.");
                var timer = Stopwatch.StartNew();
                var decision = classifier.Classify(image, default)!;
                if (decision.Status == "unavailable") throw new InvalidDataException("Candidate is unavailable in the actual adapter.");
                rows.Add(new(sample.GetProperty("id").GetString()!, split, sample.GetProperty("category").GetString()!,
                    decision.Status, decision.Kind is { } kind ? OcrCategories.Name(kind) : "unknown", decision.Confidence,
                    (decision.Candidates ?? []).Select(OcrCategories.Name).ToArray(), decision.Warnings ?? [], timer.Elapsed.TotalMilliseconds));
            }
        }
        object Summary(string split)
        {
            var selected = rows.Where(r => r.Split == split).ToArray();
            var timings = selected.Select(r => r.ElapsedMs).Order().ToArray();
            return new { images = selected.Length, perClass = expected.Select(category => new {
                category, images = selected.Count(r => r.Expected == category),
                correct = selected.Count(r => r.Expected == category && r.Predicted == category),
                wrong = selected.Count(r => r.Expected == category && r.Status == "classified" && r.Predicted != category),
                fallback = selected.Count(r => r.Expected == category && r.Status != "classified") }),
                negatives = selected.Count(r => r.Expected == "not_meter"),
                negativeFalseClassifications = selected.Count(r => r.Expected == "not_meter" && r.Status == "classified"),
                confusion = selected.GroupBy(r => (r.Expected, r.Predicted)).Select(g => new { actual = g.Key.Expected, predicted = g.Key.Predicted, count = g.Count() }),
                latencyMs = new { p50 = timings[(int)Math.Ceiling(timings.Length * .5) - 1],
                    p95 = timings[(int)Math.Ceiling(timings.Length * .95) - 1], max = timings[^1] } };
        }
        File.WriteAllText(report, JsonSerializer.Serialize(new { modelSha256 = options.VisualClassifier.Sha256,
            options.VisualClassifier.CandidateThreshold, options.VisualClassifier.NmsThreshold, options.AutomaticClassificationMinConfidence,
            validation = Summary("val"), test = Summary("test"), rows,
            activationDecision = "not_activated",
            limitation = "Small development corpus; historical test groups were previously observed. Only one new blank LCD test group. Not representative independent four-class acceptance or reading accuracy." }, OcrEvaluation.Json));
        Console.WriteLine($"Actual four-class ONNX adapter evaluated {rows.Count} validation/test images. No activation or accuracy pass is implied.");
        return 0;
    }

    private sealed record Row(string Id, string Split, string Expected, string Status, string Predicted,
        float? Confidence, IReadOnlyList<string> Candidates, IReadOnlyList<string> Warnings, double ElapsedMs);
}
