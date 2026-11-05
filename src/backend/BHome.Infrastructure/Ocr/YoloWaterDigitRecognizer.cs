using System.Security.Cryptography;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

public sealed record MeterDigitResult(string? Digits, float? Confidence, IReadOnlyList<string> Warnings)
{
    internal IReadOnlyList<YoloMeterSceneDetector.YoloBox> Detections { get; init; } = [];
    public override string ToString() => "Meter digit result (reading omitted)";
}

// Pretrained analog WATER wheel model, not a universal LCD/electricity recognizer.
public sealed class YoloWaterDigitRecognizer : IDisposable
{
    public const string FileName = "water-stage2.onnx";
    public const string Sha256 = "2100d78ae1d762327cb871ee521a8dd9e84afc34de1cd8cf58876332e5834006";
    private readonly Lazy<InferenceSession> session;
    public YoloWaterDigitRecognizer(OcrOptions options)
    {
        session = new(() =>
        {
            var directory = string.IsNullOrWhiteSpace(options.MeterDetector.ModelDirectory)
                ? Path.GetFullPath(Path.Combine(options.ModelDirectory, "..", "meter-detection-models")) : options.MeterDetector.ModelDirectory;
            var path = Path.Combine(directory, FileName);
            using var file = File.OpenRead(path);
            if (!Convert.ToHexString(SHA256.HashData(file)).Equals(Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Digit model checksum mismatch.");
            using var config = new SessionOptions { IntraOpNumThreads = options.InferenceThreads, InterOpNumThreads = 1,
                GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
            var loaded = new InferenceSession(path, config);
            if (loaded.InputMetadata.Count != 1 || !loaded.InputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 3, 416, 416 }) ||
                loaded.OutputMetadata.Count != 1 || !loaded.OutputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 16, 3549 }))
            { loaded.Dispose(); throw new InvalidDataException("Unsupported digit tensor contract."); }
            return loaded;
        });
    }
    public MeterDigitResult Recognize(Mat crop, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        try
        {
            var model = session.Value;
            var input = YoloMeterSceneDetector.Letterbox(crop, out var scale, out var left, out var top, token, 416);
            try
            {
                using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
                using var registration = token.Register(() => run.Terminate = true);
                using var result = model.Run([NamedOnnxValue.CreateFromTensor(model.InputNames[0], input)], model.OutputNames, run);
                token.ThrowIfCancellationRequested();
                var boxes = YoloMeterSceneDetector.Decode(result.First().AsTensor<float>(), crop.Size(), scale, left, top, .35f, .45f, token, digits: true);
                return Assemble(boxes) with { Detections = boxes };
            }
            finally { input.Buffer.Span.Clear(); }
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or OnnxRuntimeException or DllNotFoundException or TypeInitializationException or BadImageFormatException)
        { return new(null, null, ["digit_model_unavailable"]); }
    }
    public void Warmup(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        try { _ = session.Value; }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or OnnxRuntimeException or DllNotFoundException or TypeInitializationException or BadImageFormatException) { }
        token.ThrowIfCancellationRequested();
    }

    internal static MeterDigitResult Assemble(IReadOnlyList<YoloMeterSceneDetector.YoloBox> detections)
    {
        if (detections.Count is < 3 or > 12) return new(null, null, ["digit_count_uncertain"]);
        var boxes = detections.OrderBy(b => b.Box.Center.X).ToArray();
        if (boxes.Any(b => b.ClassId == 10)) return new(null, null, ["unclear_digit"]);
        if (boxes.Any(b => b.ClassId is < 0 or > 9 || !float.IsFinite(b.Confidence) || b.Confidence < .5f || b.Confidence > 1))
            return new(null, null, ["digit_low_confidence"]);
        // OBB digit long side is usually vertical after deskew; use bounding rect
        // for row/spacing so a w/h+90 representation cannot change the result.
        var bounds = boxes.Select(b => b.Box.BoundingRect()).ToArray();
        var typicalHeight = bounds.Select(b => b.Height).Order().ElementAt(bounds.Length / 2);
        var typicalWidth = bounds.Select(b => b.Width).Order().ElementAt(bounds.Length / 2);
        for (var i = 0; i < boxes.Length; i++)
        {
            if (Math.Abs(boxes[i].Box.Center.Y - boxes[0].Box.Center.Y) > typicalHeight * .5 || bounds[i].Height < typicalHeight * .5)
                return new(null, null, ["digit_geometry_uncertain"]);
            if (i == 0) continue;
            var distance = boxes[i].Box.Center.X - boxes[i - 1].Box.Center.X;
            if (distance < typicalWidth * .5) return new(null, null, ["digit_overlap_conflict"]);
            if (distance > typicalWidth * 2.2) return new(null, null, ["digit_gap_uncertain"]);
        }
        return new(string.Concat(boxes.Select(b => b.ClassId.ToString(System.Globalization.CultureInfo.InvariantCulture))), boxes.Min(b => b.Confidence), []);
    }
    public void Dispose() { if (session.IsValueCreated) session.Value.Dispose(); }
}
