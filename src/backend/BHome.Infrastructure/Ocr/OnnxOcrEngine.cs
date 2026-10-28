using System.Security.Cryptography;
using System.Text;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// One detector + recognizer per process. No network, file writes or image logging.
public sealed class OnnxOcrEngine : IOcrEngine, IDisposable
{
    public const string Version = "ocrdoc-ppocrv6-vi-run6-9b534643";
    private readonly OcrOptions options;
    private readonly IImagePreprocessor preprocessor;
    private readonly InferenceSession detector;
    private readonly InferenceSession recognizer;
    private readonly string[] dictionary;

    public OnnxOcrEngine(OcrOptions options, IImagePreprocessor preprocessor)
    {
        this.options = options;
        this.preprocessor = preprocessor;
        VerifyFile("detection.onnx", "eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1");
        VerifyFile("recognition.onnx", "767305d37d06728fe9578ff8132595ce23f66139df5e2937fd4131bd1dc34f12");
        VerifyFile("charset.txt", "5d801bf60472c4c1b184b6b6843aa2c754d8daf1429247e07658ee0bd79ab448");
        dictionary = ["", .. File.ReadAllLines(Path.Combine(options.ModelDirectory, "charset.txt"), Encoding.UTF8), " "];
        using var sessionOptions = new SessionOptions
        {
            IntraOpNumThreads = options.InferenceThreads,
            InterOpNumThreads = 1,
            GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
            LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL
        };
        detector = new InferenceSession(Path.Combine(options.ModelDirectory, "detection.onnx"), sessionOptions);
        try
        {
            recognizer = new InferenceSession(Path.Combine(options.ModelDirectory, "recognition.onnx"), sessionOptions);
            if (detector.InputMetadata.Count != 1 || recognizer.InputMetadata.Count != 1 ||
                detector.InputMetadata.First().Value.Dimensions.Length != 4 || recognizer.InputMetadata.First().Value.Dimensions.Length != 4)
                throw new InvalidDataException("Unsupported OCR model contract.");
        }
        catch { detector.Dispose(); recognizer?.Dispose(); throw; }
    }

    private void VerifyFile(string name, string expected)
    {
        using var stream = File.OpenRead(Path.Combine(options.ModelDirectory, name));
        if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("OCR model checksum mismatch.");
    }

    public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken cancellationToken)
        => Task.Run(() => Recognize(image, kind, cancellationToken), cancellationToken);

    private OcrText Recognize(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var prepared = preprocessor.Prepare(image, kind);
        using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        using var registration = token.Register(() => run.Terminate = true);
        var lines = new List<OcrLine>();
        var warnings = prepared.Warnings.ToList();
        try
        {
            var regions = Detect(prepared.Image, run, token);
            if (regions.Count > options.MaxTextRegions) warnings.Add("text_region_limit");
            foreach (var region in regions.Take(options.MaxTextRegions))
            {
                token.ThrowIfCancellationRequested();
                using var crop = Crop(prepared.Image, region);
                var line = ReadLine(crop, run);
                if (line.Text.Length > 0) lines.Add(line);
            }
            token.ThrowIfCancellationRequested();
            if (lines.Count == 0) warnings.Add("no_text");
            return new OcrText(lines, Version, warnings);
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
    }

    private List<RotatedRect> Detect(Mat image, RunOptions run, CancellationToken token)
    {
        var ratio = Math.Min(1d, 960d / Math.Max(image.Width, image.Height));
        var width = Math.Max(32, (int)Math.Round(image.Width * ratio / 32) * 32);
        var height = Math.Max(32, (int)Math.Round(image.Height * ratio / 32) * 32);
        using var resized = new Mat();
        Cv2.Resize(image, resized, new Size(width, height));
        var input = Tensor(resized, width, height, detection: true);
        using var output = detector.Run([NamedOnnxValue.CreateFromTensor(detector.InputNames[0], input)], detector.OutputNames, run);
        var map = output.First().AsTensor<float>();
        if (map.Rank != 4 || map.Dimensions[0] != 1 || map.Dimensions[1] != 1)
            throw new InvalidDataException("Unsupported detector output.");
        var mh = map.Dimensions[2]; var mw = map.Dimensions[3];
        using var mask = new Mat(mh, mw, MatType.CV_8UC1);
        for (var y = 0; y < mh; y++)
        {
            token.ThrowIfCancellationRequested();
            for (var x = 0; x < mw; x++) mask.Set(y, x, map[0, 0, y, x] > .3f ? (byte)255 : (byte)0);
        }
        Cv2.FindContours(mask, out Point[][] contours, out _, RetrievalModes.List, ContourApproximationModes.ApproxSimple);
        var boxes = new List<RotatedRect>();
        foreach (var contour in contours.OrderByDescending(c => Math.Abs(Cv2.ContourArea(c))).Take(256))
        {
            token.ThrowIfCancellationRequested();
            if (contour.Length < 3 || Math.Abs(Cv2.ContourArea(contour)) < 6) continue;
            var rect = Cv2.BoundingRect(contour);
            var sum = 0d; var count = 0;
            for (var y = rect.Top; y < rect.Bottom; y++)
                for (var x = rect.Left; x < rect.Right; x++)
                    if (mask.At<byte>(y, x) != 0) { sum += map[0, 0, y, x]; count++; }
            if (count == 0 || sum / count < .5) continue;
            var box = Cv2.MinAreaRect(contour.Select(p => new Point2f((float)p.X * image.Width / mw, (float)p.Y * image.Height / mh)));
            // Conservative rectangle expansion instead of polygon unclip; retain diacritics.
            var padding = Math.Min(box.Size.Width, box.Size.Height) * .5f;
            boxes.Add(new RotatedRect(box.Center, new Size2f(box.Size.Width + padding, box.Size.Height + padding), box.Angle));
        }
        return boxes.OrderBy(b => Math.Round(b.Center.Y / 12)).ThenBy(b => b.Center.X).ToList();
    }

    private static Mat Crop(Mat source, RotatedRect region)
    {
        // Order corners TL/TR/BR/BL, correct local text-line perspective/rotation.
        var points = region.Points();
        var sorted = points.OrderBy(p => p.Y).ToArray();
        var top = sorted.Take(2).OrderBy(p => p.X).ToArray();
        var bottom = sorted.Skip(2).OrderBy(p => p.X).ToArray();
        Point2f[] src = [top[0], top[1], bottom[1], bottom[0]];
        var width = Math.Max(2, (int)Math.Max(src[0].DistanceTo(src[1]), src[2].DistanceTo(src[3])));
        var height = Math.Max(2, (int)Math.Max(src[0].DistanceTo(src[3]), src[1].DistanceTo(src[2])));
        Point2f[] dst = [new(0, 0), new(width - 1, 0), new(width - 1, height - 1), new(0, height - 1)];
        using var transform = Cv2.GetPerspectiveTransform(src, dst);
        var result = new Mat();
        Cv2.WarpPerspective(source, result, transform, new Size(width, height), InterpolationFlags.Linear,
            BorderTypes.Replicate);
        return result;
    }

    private OcrLine ReadLine(Mat crop, RunOptions run)
    {
        const int height = 48;
        const int width = 320;
        var actualWidth = Math.Clamp((int)Math.Ceiling(height * crop.Width / (double)crop.Height), 1, width);
        using var resized = new Mat();
        Cv2.Resize(crop, resized, new Size(actualWidth, height));
        using var padded = new Mat(height, width, MatType.CV_8UC3, Scalar.All(127));
        using (var roi = new Mat(padded, new Rect(0, 0, actualWidth, height))) resized.CopyTo(roi);
        var input = Tensor(padded, width, height, detection: false);
        using var output = recognizer.Run([NamedOnnxValue.CreateFromTensor(recognizer.InputNames[0], input)], recognizer.OutputNames, run);
        var scores = output.First().AsTensor<float>();
        if (scores.Rank != 3 || scores.Dimensions[0] != 1 || scores.Dimensions[2] != dictionary.Length)
            throw new InvalidDataException("Recognizer dictionary contract mismatch.");
        var text = new StringBuilder(); var confidence = 0f; var count = 0; var last = 0;
        for (var step = 0; step < scores.Dimensions[1]; step++)
        {
            var best = 0;
            for (var c = 1; c < dictionary.Length; c++) if (scores[0, step, c] > scores[0, step, best]) best = c;
            if (best != 0 && best != last)
            { text.Append(dictionary[best]); confidence += scores[0, step, best]; count++; }
            last = best;
        }
        return new(text.ToString().Trim(), count == 0 ? 0 : Math.Clamp(confidence / count, 0, 1));
    }

    private static DenseTensor<float> Tensor(Mat image, int width, int height, bool detection)
    {
        var data = new DenseTensor<float>(new[] { 1, 3, height, width });
        float[] means = [.485f, .456f, .406f]; float[] std = [.229f, .224f, .225f];
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var pixel = image.At<Vec3b>(y, x);
                for (var c = 0; c < 3; c++)
                {
                    // Detector uses RGB/ImageNet; recognizer uses Paddle's BGR [-1,1].
                    var value = pixel[detection ? 2 - c : c] / 255f;
                    data[0, c, y, x] = detection ? (value - means[c]) / std[c] : (value - .5f) / .5f;
                }
            }
        return data;
    }

    public void Dispose() { detector.Dispose(); recognizer.Dispose(); }
}
