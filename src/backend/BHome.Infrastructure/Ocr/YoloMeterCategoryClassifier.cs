using System.Security.Cryptography;
using System.Text.RegularExpressions;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Four-class body detection only: no claim about display, digits or register.
// Rejected/three-class research checkpoints cannot satisfy this tensor/metadata
// contract. Weights are never acquired from the network by the application.
public sealed class YoloMeterCategoryClassifier : IImageCategoryClassifier, IDisposable
{
    public static IReadOnlyList<OcrDocumentKind> Categories { get; } = Array.AsReadOnly(new[] {
        OcrDocumentKind.MechanicalElectricity, OcrDocumentKind.DigitalElectricity,
        OcrDocumentKind.MechanicalWater, OcrDocumentKind.DigitalWater });
    private readonly OcrOptions options;
    private readonly bool development;
    private readonly Lazy<InferenceSession> session;

    public YoloMeterCategoryClassifier(OcrOptions options, bool development)
    {
        this.options = options; this.development = development;
        session = new Lazy<InferenceSession>(Load);
    }

    private InferenceSession Load()
    {
        if (!development || !options.VisualClassifier.Enabled || !options.VisualClassifier.IsValid() ||
            options.VisualClassifier.CandidateThreshold > options.AutomaticClassificationMinConfidence)
            throw new InvalidDataException("Visual classifier configuration is unsupported.");
        var file = new FileInfo(options.VisualClassifier.ModelPath);
        if (file.LinkTarget is not null || file.Length is <= 0 or > 50 * 1024 * 1024)
            throw new InvalidDataException("Visual classifier artifact is unsupported.");
        // Load the verified bytes themselves to avoid a hash/open replacement race.
        var bytes = File.ReadAllBytes(file.FullName);
        try
        {
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(options.VisualClassifier.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Visual classifier checksum mismatch.");
            using var config = new SessionOptions { IntraOpNumThreads = options.InferenceThreads, InterOpNumThreads = 1,
                GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
            var model = new InferenceSession(bytes, config);
            try
            {
                if (model.InputMetadata.Count != 1 || model.OutputMetadata.Count != 1 ||
                    !model.InputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 3, 416, 416 }) ||
                    !model.OutputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 8, 3549 }) ||
                    model.InputMetadata.First().Value.ElementType != typeof(float) || model.OutputMetadata.First().Value.ElementType != typeof(float) ||
                    !model.ModelMetadata.CustomMetadataMap.TryGetValue("names", out var names) || !ValidNames(names))
                    throw new InvalidDataException("Unsupported four-class tensor or class mapping.");
                return model;
            }
            catch { model.Dispose(); throw; }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    // Ultralytics serializes the names dictionary using Python repr, not JSON.
    private static bool ValidNames(string names)
    {
        if (names.Length > 256) return false;
        var expected = string.Join(@"\s*,\s*", Categories.Select((kind, index) =>
            $"{index}\\s*:\\s*['\"]{OcrCategories.Name(kind)}['\"]"));
        return Regex.IsMatch(names, @"^\{\s*" + expected + @"\s*\}$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
    }

    public void Warmup(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!options.VisualClassifier.Enabled || !development) return;
        try { _ = session.Value; }
        catch (Exception error) when (Unavailable(error)) { /* Request returns a safe warning. */ }
        token.ThrowIfCancellationRequested();
    }

    public OcrCategoryDecision? Classify(Mat preparedImage, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!options.VisualClassifier.Enabled) return null;
        if (!development) return Missing();
        try
        {
            var model = session.Value;
            var input = YoloMeterSceneDetector.Letterbox(preparedImage, out var scale, out var left, out var top, token, 416);
            try
            {
                using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
                using var registration = token.Register(() => run.Terminate = true);
                using var result = model.Run([NamedOnnxValue.CreateFromTensor(model.InputNames[0], input)], model.OutputNames, run);
                token.ThrowIfCancellationRequested();
                return Decide(Decode(result.First().AsTensor<float>(), preparedImage.Size(), scale, left, top,
                    options.VisualClassifier.CandidateThreshold, options.VisualClassifier.NmsThreshold, token), options.AutomaticClassificationMinConfidence);
            }
            finally { input.Buffer.Span.Clear(); }
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
        catch (Exception error) when (Unavailable(error)) { return Missing(); }
    }

    public sealed record Detection(OcrDocumentKind Category, float Confidence, Rect2d Bounds);

    public static IReadOnlyList<Detection> Decode(Tensor<float> output, Size image, double scale, int left, int top,
        float threshold, float nms, CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested();
        if (output.Rank != 3 || output.Dimensions[0] != 1 || output.Dimensions[1] != 8 || output.Dimensions[2] != 3549 ||
            image.Width <= 0 || image.Height <= 0 || !double.IsFinite(scale) || scale <= 0 ||
            !float.IsFinite(threshold) || threshold is <= 0 or > 1 || !float.IsFinite(nms) || nms is <= 0 or > 1)
            throw new InvalidDataException("Unsupported category tensor or geometry.");
        var candidates = new List<Detection>();
        for (var i = 0; i < 3549; i++)
        {
            if (i % 128 == 0) token.ThrowIfCancellationRequested();
            // A corrupt score in any class must not conceal a competing class.
            var scores = Enumerable.Range(0, 4).Select(c => output[0, 4 + c, i]).ToArray();
            if (scores.Any(s => !float.IsFinite(s) || s is < 0 or > 1)) throw new InvalidDataException("Invalid category scores.");
            if (scores.Max() < threshold) continue;
            var cx = output[0, 0, i]; var cy = output[0, 1, i]; var width = output[0, 2, i]; var height = output[0, 3, i];
            if (!float.IsFinite(cx + cy + width + height) || width <= 0 || height <= 0) throw new InvalidDataException("Invalid category bounds.");
            var x1 = Math.Clamp((cx - width / 2d - left) / scale, 0, image.Width);
            var y1 = Math.Clamp((cy - height / 2d - top) / scale, 0, image.Height);
            var x2 = Math.Clamp((cx + width / 2d - left) / scale, 0, image.Width);
            var y2 = Math.Clamp((cy + height / 2d - top) / scale, 0, image.Height);
            if (x2 <= x1 || y2 <= y1) continue;
            // Multi-label candidates retain conflicting class evidence at the
            // same anchor instead of silently taking the largest score.
            for (var c = 0; c < 4; c++)
                if (scores[c] >= threshold) candidates.Add(new(Categories[c], scores[c], new(x1, y1, x2 - x1, y2 - y1)));
            if (candidates.Count > 1024) throw new InvalidDataException("Category detection limit exceeded.");
        }
        var kept = new List<Detection>();
        foreach (var candidate in candidates.OrderByDescending(d => d.Confidence))
        {
            token.ThrowIfCancellationRequested();
            if (!kept.Any(other => other.Category == candidate.Category && IoU(other.Bounds, candidate.Bounds) > nms)) kept.Add(candidate);
            if (kept.Count > 64) throw new InvalidDataException("Category detection limit exceeded.");
        }
        return kept;
    }

    private static double IoU(Rect2d a, Rect2d b)
    {
        var intersection = Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X)) *
            Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - Math.Max(a.Y, b.Y));
        return intersection / (a.Width * a.Height + b.Width * b.Height - intersection);
    }

    public static OcrCategoryDecision Decide(IReadOnlyList<Detection> detections, float minimumConfidence)
    {
        if (!float.IsFinite(minimumConfidence) || minimumConfidence is <= 0 or > 1)
            throw new InvalidDataException("Unsupported category confidence threshold.");
        if (detections.Count == 0) return new("unknown", null, "visual_model", Warnings: ["classification_insufficient_evidence"]);
        if (detections.Count != 1) return new("ambiguous", null, "visual_model",
            Candidates: detections.Select(d => d.Category).ToArray(), Warnings: ["multiple_meters"]);
        var found = detections[0];
        if (!Categories.Contains(found.Category) || !float.IsFinite(found.Confidence) || found.Confidence < minimumConfidence || found.Confidence > 1)
            return new("ambiguous", null, "visual_model", Candidates: [found.Category], Warnings: ["classification_requires_review"]);
        return new("classified", found.Category, "visual_model", found.Confidence);
    }

    private static bool Unavailable(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException or
        OnnxRuntimeException or DllNotFoundException or TypeInitializationException or BadImageFormatException;
    private static OcrCategoryDecision Missing() => new("unavailable", null, "visual_model", Warnings: ["visual_classifier_unavailable"]);
    public void Dispose() { if (session.IsValueCreated) session.Value.Dispose(); }
}
