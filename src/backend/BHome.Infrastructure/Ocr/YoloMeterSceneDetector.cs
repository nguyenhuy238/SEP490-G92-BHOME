using System.Security.Cryptography;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Pinned pretrained stage-1 YOLOv8 OBB. Its meter/window classes are localization
// capabilities, not a four-class utility/display classifier. No digit substitution.
public sealed class YoloMeterSceneDetector : IMeterSceneDetector, IDisposable
{
    public const string FileName = "water-stage1.onnx";
    public const string Sha256 = "5311b093b39a2ef752c2052e2755ab8f595613d37d612e48c10dc26f6ecb9d44";
    private readonly OcrOptions options;
    private readonly Lazy<InferenceSession> session;
    public YoloMeterSceneDetector(OcrOptions options)
    {
        this.options = options;
        session = new Lazy<InferenceSession>(() =>
        {
            var directory = string.IsNullOrWhiteSpace(options.MeterDetector.ModelDirectory)
                ? Path.GetFullPath(Path.Combine(options.ModelDirectory, "..", "meter-detection-models")) : options.MeterDetector.ModelDirectory;
            var path = Path.Combine(directory, FileName);
            using var file = File.OpenRead(path);
            if (!Convert.ToHexString(SHA256.HashData(file)).Equals(Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Meter detector checksum mismatch.");
            using var config = new SessionOptions
            {
                IntraOpNumThreads = options.InferenceThreads,
                InterOpNumThreads = 1,
                GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
                LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL
            };
            var loaded = new InferenceSession(path, config);
            if (loaded.InputMetadata.Count != 1 || !loaded.InputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 3, 640, 640 }) ||
                loaded.OutputMetadata.Count != 1 || !loaded.OutputMetadata.First().Value.Dimensions.SequenceEqual(new[] { 1, 18, 8400 }))
            { loaded.Dispose(); throw new InvalidDataException("Unsupported meter detector tensor contract."); }
            return loaded;
        });
    }

    // Only analog water displays were evaluated. Other trusted task types retain
    // the existing PP-OCR/manual path rather than applying an unvalidated model.
    public bool Supports(OcrDocumentKind kind) => kind == OcrDocumentKind.MechanicalWater;

    public void Warmup(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!options.MeterDetector.Enabled) return;
        try { _ = session.Value; }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or OnnxRuntimeException or DllNotFoundException or TypeInitializationException or BadImageFormatException)
        { /* Detect reports model unavailability; identity OCR remains available. */ }
        token.ThrowIfCancellationRequested();
    }

    public MeterScene Detect(Mat image, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!options.MeterDetector.Enabled) return new(false, []);
        try
        {
            var model = session.Value;
            var input = Letterbox(image, out var scale, out var left, out var top, token);
            try
            {
                using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
                using var registration = token.Register(() => run.Terminate = true);
                using var output = model.Run([NamedOnnxValue.CreateFromTensor(model.InputNames[0], input)], model.OutputNames, run);
                token.ThrowIfCancellationRequested();
                var boxes = Decode(output.First().AsTensor<float>(), image.Size(), scale, left, top,
                    options.MeterDetector.ConfidenceThreshold, options.MeterDetector.NmsThreshold, token);
                var warnings = new List<string>();
                var meters = boxes.Where(b => b.ClassId == 0).ToArray();
                var windows = boxes.Where(b => b.ClassId == 1).ToArray();
                var unclear = boxes.Where(b => b.ClassId == 12).ToArray();
                var claimed = new HashSet<YoloBox>();
                DetectedReadingRegion Region(YoloBox box) => new(ClippedBounds(box.Box, image.Size()), box.Confidence) { OrientedBounds = box.Box };
                var result = new List<DetectedMeter>();
                foreach (var meter in meters)
                {
                    var bounds = ClippedBounds(meter.Box, image.Size());
                    var ownWindows = windows.Where(w => bounds.Contains(new Point((int)w.Box.Center.X, (int)w.Box.Center.Y))).ToArray();
                    foreach (var window in ownWindows) claimed.Add(window);
                    result.Add(new(bounds, meter.Confidence, ReadingRegions: ownWindows.Select(Region).ToArray()));
                }
                if (unclear.Any(u => windows.Any(w => ClippedBounds(w.Box, image.Size()).Contains(new Point((int)u.Box.Center.X, (int)u.Box.Center.Y)))))
                    warnings.Add("unclear_digit");
                return new(true, result) { StandaloneReadingRegions = windows.Where(w => !claimed.Contains(w)).Select(Region).ToArray(), Warnings = warnings };
            }
            finally { input.Buffer.Span.Clear(); }
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or OnnxRuntimeException or DllNotFoundException or TypeInitializationException or BadImageFormatException)
        { return new(false, []) { Warnings = ["meter_detector_unavailable"] }; }
    }

    public static DenseTensor<float> Letterbox(Mat image, out double ratio, out int left, out int top, CancellationToken token = default, int size = 640)
    {
        if (image.Empty() || image.Type() != MatType.CV_8UC3) throw new OcrInputException("corrupted_image");
        ratio = Math.Min((double)size / image.Width, (double)size / image.Height);
        var width = (int)Math.Round(image.Width * ratio); var height = (int)Math.Round(image.Height * ratio);
        left = (int)Math.Round((size - width) / 2d - .1); top = (int)Math.Round((size - height) / 2d - .1);
        using var resized = new Mat(); Cv2.Resize(image, resized, new(width, height), 0, 0, InterpolationFlags.Linear);
        using var padded = new Mat(size, size, MatType.CV_8UC3, Scalar.All(114));
        using (var roi = new Mat(padded, new Rect(left, top, width, height))) resized.CopyTo(roi);
        var tensor = new DenseTensor<float>(new[] { 1, 3, size, size });
        try
        {
            for (var y = 0; y < size; y++)
            {
                token.ThrowIfCancellationRequested();
                for (var x = 0; x < size; x++)
                {
                    var pixel = padded.At<Vec3b>(y, x);
                    for (var c = 0; c < 3; c++) tensor[0, c, y, x] = pixel[2 - c] / 255f;
                }
            }
            return tensor;
        }
        catch { tensor.Buffer.Span.Clear(); throw; }
        finally { resized.SetTo(Scalar.All(0)); padded.SetTo(Scalar.All(0)); }
    }

    public sealed record YoloBox(int ClassId, float Confidence, RotatedRect Box);
    public static IReadOnlyList<YoloBox> Decode(Tensor<float> output, Size imageSize, double scale, int left, int top, float threshold, float nms, CancellationToken token = default, bool digits = false)
    {
        var classes = digits ? 11 : 13;
        var anchors = digits ? 3549 : 8400;
        // Ultralytics scale_boxes reconstructs padding from the unrounded source
        // dimensions, which can differ by one pixel from the letterbox ROI.
        // Preserve this convention for native postprocessing parity.
        var inputSize = digits ? 416 : 640;
        left = (int)Math.Round((inputSize - imageSize.Width * scale) / 2 - .1);
        top = (int)Math.Round((inputSize - imageSize.Height * scale) / 2 - .1);
        if (output.Rank != 3 || output.Dimensions[0] != 1 || output.Dimensions[1] != classes + 5 || output.Dimensions[2] != anchors)
            throw new InvalidDataException("Unsupported YOLO output.");
        var candidates = new List<YoloBox>();
        for (var i = 0; i < anchors; i++)
        {
            if (i % 128 == 0) token.ThrowIfCancellationRequested();
            var cls = 0; var score = output[0, 4, i];
            for (var c = 1; c < classes; c++) if (output[0, 4 + c, i] > score) { cls = c; score = output[0, 4 + c, i]; }
            if ((!digits && cls is not (0 or 1 or 12)) || !float.IsFinite(score) || score < threshold || score > 1) continue;
            var x = (output[0, 0, i] - left) / scale; var y = (output[0, 1, i] - top) / scale;
            var w = output[0, 2, i] / scale; var h = output[0, 3, i] / scale; var angle = output[0, classes + 4, i];
            if (!double.IsFinite(x + y + w + h + angle) || w <= 0 || h <= 0 || w > imageSize.Width * 2 || h > imageSize.Height * 2 ||
                x < 0 || y < 0 || x >= imageSize.Width || y >= imageSize.Height) continue;
            candidates.Add(new(cls, score, new(new((float)x, (float)y), new((float)w, (float)h), angle * 180f / MathF.PI)));
        }
        if (candidates.Count > 1024) throw new InvalidDataException("Meter detection limit exceeded.");
        var sorted = candidates.OrderByDescending(b => b.Confidence).ToArray();
        // Ultralytics OBB fast NMS suppresses against all higher-scoring candidates.
        var kept = sorted.Where((box, i) => { token.ThrowIfCancellationRequested(); return !sorted.Take(i).Any(other => other.ClassId == box.ClassId && Similarity(other.Box, box.Box) > nms); }).ToArray();
        if (kept.Length > 64) throw new InvalidDataException("Meter detection limit exceeded.");
        return kept;
    }

    public static double Similarity(RotatedRect first, RotatedRect second)
    {
        static (double A, double B, double C) Covariance(RotatedRect box)
        {
            var theta = box.Angle * Math.PI / 180; var c = Math.Cos(theta); var s = Math.Sin(theta);
            var a = box.Size.Width * box.Size.Width / 12d; var b = box.Size.Height * box.Size.Height / 12d;
            return (a * c * c + b * s * s, a * s * s + b * c * c, (a - b) * c * s);
        }
        const double epsilon = 1e-7;
        var p = Covariance(first); var q = Covariance(second);
        var dx = first.Center.X - second.Center.X; var dy = first.Center.Y - second.Center.Y;
        var denominator = (p.A + q.A) * (p.B + q.B) - Math.Pow(p.C + q.C, 2) + epsilon;
        var distance = ((p.A + q.A) * dy * dy + (p.B + q.B) * dx * dx) / denominator * .25 -
            (p.C + q.C) * dx * dy / denominator * .5 +
            Math.Log(denominator / (4 * Math.Sqrt(Math.Max(0, p.A * p.B - p.C * p.C) * Math.Max(0, q.A * q.B - q.C * q.C)) + epsilon) + epsilon) * .5;
        return 1 - Math.Sqrt(1 - Math.Exp(-Math.Clamp(distance, epsilon, 100)) + epsilon);
    }

    private static Rect ClippedBounds(RotatedRect box, Size image) => box.BoundingRect().Intersect(new(0, 0, image.Width, image.Height));
    public void Dispose() { if (session.IsValueCreated) session.Value.Dispose(); }
}
