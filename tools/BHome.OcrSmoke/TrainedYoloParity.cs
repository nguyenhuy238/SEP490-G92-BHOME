using System.Security.Cryptography;
using System.Text.Json;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

// Offline candidate verification only: no DI registration or OCR activation.
internal static class TrainedYoloParity
{
    public static int Run(string directory, string report)
    {
        try
        {
            var root = Path.GetFullPath(directory);
            using var metadata = JsonDocument.Parse(File.ReadAllText(Child(root, "dotnet-parity.json", 1024 * 1024)));
            var manifest = metadata.RootElement;
            var model = Child(root, manifest.GetProperty("model").GetString()!, 50 * 1024 * 1024);
            using (var stream = File.OpenRead(model))
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(manifest.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Model checksum mismatch");
            var classes = manifest.GetProperty("classes").EnumerateArray().Select(x => x.GetString()).ToArray();
            string?[] meterClasses = ["electricity_mechanical", "electricity_digital", "water_mechanical", "water_digital"];
            if (!(classes.Length is 3 or 4 && classes.SequenceEqual(meterClasses.Take(classes.Length))) &&
                !classes.SequenceEqual(Enumerable.Range(0, 10).Select(x => x.ToString(System.Globalization.CultureInfo.InvariantCulture))) &&
                !classes.SequenceEqual(new[] { "reading_region", "serial_region" }))
                throw new InvalidDataException("Unsupported class order");
            using var options = new SessionOptions { IntraOpNumThreads = 2, InterOpNumThreads = 1 };
            using var session = new InferenceSession(model, options);
            int[] inputShape = [1, 3, 416, 416];
            int[] outputShape = [1, 4 + classes.Length, 3549];
            if (session.InputMetadata.Count != 1 || session.OutputMetadata.Count != 1 ||
                !session.InputMetadata.First().Value.Dimensions.SequenceEqual(inputShape) ||
                !session.OutputMetadata.First().Value.Dimensions.SequenceEqual(outputShape) ||
                session.InputMetadata.First().Value.ElementType != typeof(float) || session.OutputMetadata.First().Value.ElementType != typeof(float))
                throw new InvalidDataException("Unsupported tensor contract");
            var samples = manifest.GetProperty("samples").EnumerateArray().ToArray();
            if (samples.Length is < 1 or > 10) throw new InvalidDataException("Bounded parity sample count required");
            var rows = new List<object>();
            var passed = true;
            foreach (var sample in samples)
            {
                var reference = Path.Combine(root, "parity");
                using var image = Cv2.ImRead(Child(reference, sample.GetProperty("image").GetString()!, 5 * 1024 * 1024));
                if (image.Empty() || image.Width * (long)image.Height > 12_000_000) throw new InvalidDataException("Invalid parity image");
                var input = YoloMeterSceneDetector.Letterbox(image, out _, out _, out _, size: 416);
                try
                {
                    var expectedInput = Floats(Child(reference, sample.GetProperty("input").GetString()!, 3 * 1024 * 1024), checked((int)input.Length));
                    var inputDelta = input.Buffer.Span.ToArray().Zip(expectedInput, (a, b) => Math.Abs(a - b)).Max();
                    using var result = session.Run([NamedOnnxValue.CreateFromTensor(session.InputNames[0], input)]);
                    var actual = result.First().AsTensor<float>().ToArray();
                    var expected = Floats(Child(reference, sample.GetProperty("output").GetString()!, 1024 * 1024), actual.Length);
                    var outputMatch = actual.Zip(expected, (a, b) => float.IsFinite(a) && float.IsFinite(b) && Math.Abs(a - b) <= .002f + .002f * Math.Abs(b)).All(x => x);
                    var outputDelta = actual.Zip(expected, (a, b) => Math.Abs(a - b)).Max();
                    var match = float.IsFinite(inputDelta) && inputDelta <= 1e-6 && outputMatch;
                    passed &= match;
                    rows.Add(new { id = sample.GetProperty("id").GetString(), inputMaxDelta = inputDelta, outputMaxDelta = outputDelta, passed = match });
                    Array.Clear(expectedInput); Array.Clear(expected); Array.Clear(actual);
                }
                finally { input.Buffer.Span.Clear(); }
            }
            File.WriteAllText(report, JsonSerializer.Serialize(new
            {
                passed,
                inputShape,
                outputShape,
                classes,
                rows,
                limitation = "Preprocessing and tensor parity only; no category, reading accuracy or runtime activation claim."
            }, OcrEvaluation.Json));
            Console.WriteLine($"Fine-tuned .NET/ORT parity: {passed}, {rows.Count} images");
            return passed ? 0 : 1;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or OnnxRuntimeException)
        {
            Console.Error.WriteLine("Fine-tuned parity input invalid, unavailable or incompatible. No image/text/value is logged.");
            return 2;
        }
    }

    private static string Child(string root, string name, int limit)
    {
        if (string.IsNullOrWhiteSpace(name) || Path.GetFileName(name) != name || name.Contains(':') || name.Contains('\\') || name is "." or "..")
            throw new InvalidDataException("Unsafe artifact path");
        var path = Path.Combine(root, name);
        var file = new FileInfo(path);
        if (file.LinkTarget is not null || file.Length is <= 0 || file.Length > limit) throw new InvalidDataException("Invalid artifact");
        return path;
    }

    private static float[] Floats(string path, int length)
    {
        var bytes = File.ReadAllBytes(path);
        if (!BitConverter.IsLittleEndian || bytes.Length != checked(length * sizeof(float))) throw new InvalidDataException("Invalid reference tensor");
        var values = new float[length]; Buffer.BlockCopy(bytes, 0, values, 0, bytes.Length); Array.Clear(bytes);
        return values;
    }
}
