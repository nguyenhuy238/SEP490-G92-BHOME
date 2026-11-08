using System.Security.Cryptography;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Deliberately not registered as IImageCategoryClassifier: no business routing.
public sealed class ExperimentalVisualMeterClassifier : IDisposable
{
    private readonly OcrOptions options;
    private readonly bool development;
    private readonly Lazy<InferenceSession> session;
    public ExperimentalVisualMeterClassifier(OcrOptions options, bool development)
    {
        this.options = options; this.development = development;
        session = new(Load, LazyThreadSafetyMode.ExecutionAndPublication);
    }
    private InferenceSession Load()
    {
        var config = options.ExperimentalMeter;
        if (!development || !config.Enabled) throw new InvalidDataException("Experimental classifier disabled.");
        var file = new FileInfo(config.ClassifierPath);
        if (!file.Exists || file.Length is < 1024 or > 512 * 1024 * 1024 || file.LinkTarget is not null) throw new InvalidDataException("Classifier unavailable.");
        using (var stream = file.OpenRead())
            if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(config.ClassifierSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Classifier integrity mismatch.");
        using var settings = new SessionOptions { IntraOpNumThreads = options.InferenceThreads, InterOpNumThreads = 1, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        var result = new InferenceSession(file.FullName, settings);
        if (result.InputMetadata.Count != 1 || !result.InputMetadata.TryGetValue("pixel_values", out var input) ||
            input.ElementType != typeof(float) || !input.Dimensions.SequenceEqual([1, 3, 224, 224]) || result.OutputMetadata.Count != 2 ||
            !result.OutputMetadata.TryGetValue("utility_logits", out var utility) || utility.ElementType != typeof(float) || !utility.Dimensions.SequenceEqual([1, 3]) ||
            !result.OutputMetadata.TryGetValue("technology_logits", out var technology) || technology.ElementType != typeof(float) || !technology.Dimensions.SequenceEqual([1, 2]))
        { result.Dispose(); throw new InvalidDataException("Classifier tensor contract mismatch."); }
        var metadata = result.ModelMetadata.CustomMetadataMap;
        if (!metadata.TryGetValue("bhome.utility_classes", out var u) || u != "electricity,water,not_meter" ||
            !metadata.TryGetValue("bhome.technology_classes", out var t) || t != "mechanical,digital" ||
            !metadata.TryGetValue("bhome.preprocessing", out var prep) || prep != "rgb-cubic-letterbox224-clip-v1")
        { result.Dispose(); throw new InvalidDataException("Classifier class order/preprocessing mismatch."); }
        return result;
    }
    internal static DenseTensor<float> Pixels(Mat image)
    {
        var scale = Math.Min(224d / image.Width, 224d / image.Height);
        var width = Math.Max(1, (int)Math.Round(image.Width * scale)); var height = Math.Max(1, (int)Math.Round(image.Height * scale));
        using var resized = new Mat(); Cv2.Resize(image, resized, new(width, height), 0, 0, InterpolationFlags.Cubic);
        using var padded = new Mat(224, 224, MatType.CV_8UC3, new Scalar(104, 117, 123));
        using (var roi = new Mat(padded, new Rect((224 - width) / 2, (224 - height) / 2, width, height))) resized.CopyTo(roi);
        var tensor = new DenseTensor<float>(new[] { 1, 3, 224, 224 });
        float[] mean = [.48145466f, .4578275f, .40821073f], std = [.26862954f, .26130258f, .27577711f];
        for (var y = 0; y < 224; y++) for (var x = 0; x < 224; x++)
            { var pixel = padded.At<Vec3b>(y, x); for (var c = 0; c < 3; c++) tensor[0, c, y, x] = (pixel[2 - c] / 255f - mean[c]) / std[c]; }
        return tensor;
    }
    public (OcrCategoryDecision Decision, OcrDocumentKind? Guess) Classify(Mat image, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var model = session.Value; var tensor = Pixels(image);
        try
        {
            using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
            using var registration = token.Register(() => run.Terminate = true);
            using var output = model.Run([NamedOnnxValue.CreateFromTensor("pixel_values", tensor)], ["utility_logits", "technology_logits"], run);
            var u = Probability(output.First(o => o.Name == "utility_logits").AsTensor<float>().ToArray());
            var t = Probability(output.First(o => o.Name == "technology_logits").AsTensor<float>().ToArray());
            var ui = Array.IndexOf(u, u.Max()); var ti = Array.IndexOf(t, t.Max());
            if (ui == 2) return (new("unknown", null, "experimental_supervised_clip", u[ui], Warnings: ["not_meter_or_unsupported_image", "experimental_model"]), null);
            var kind = (ui, ti) switch { (0, 0) => OcrDocumentKind.MechanicalElectricity, (0, 1) => OcrDocumentKind.DigitalElectricity, (1, 0) => OcrDocumentKind.MechanicalWater, _ => OcrDocumentKind.DigitalWater };
            var accepted = u[ui] >= options.ExperimentalMeter.UtilityThreshold && t[ti] >= options.ExperimentalMeter.TechnologyThreshold &&
                u.OrderDescending().First() - u.OrderDescending().Skip(1).First() >= .1f && Math.Abs(t[0] - t[1]) >= .1f;
            return (new(accepted ? "classified" : "unknown", accepted ? kind : null, "experimental_supervised_clip", Math.Min(u[ui], t[ti]),
                Candidates: [kind], Warnings: ["experimental_model", "category_requires_human_review"]), kind);
        }
        finally { tensor.Buffer.Span.Clear(); }
    }
    private static float[] Probability(float[] logits)
    {
        if (logits.Any(v => !float.IsFinite(v))) throw new InvalidDataException("Invalid classifier scores.");
        var max = logits.Max(); var values = logits.Select(v => MathF.Exp(v - max)).ToArray(); var sum = values.Sum();
        return values.Select(v => v / sum).ToArray();
    }
    public void Warmup(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!development || !options.ExperimentalMeter.Enabled) return;
        try { _ = session.Value; }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or OnnxRuntimeException) { }
    }
    public void Dispose() { if (session.IsValueCreated) session.Value.Dispose(); }
}
