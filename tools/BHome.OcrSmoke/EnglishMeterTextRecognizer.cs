using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Ocr;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

// Offline candidate adapter; not registered in application DI/configuration.
// Official Paddle English CTC provides stronger digit evidence than the existing
// Vietnamese recognizer on some water windows. It is not a category classifier.
internal sealed class EnglishMeterTextRecognizer : IDisposable
{
    public const string ModelSha256 = "b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f";
    public const string DictionarySha256 = "3a3e5abea6e7d403209043c8d67b052414ae59ece49922cc7e3ac205d59060a8";
    private readonly InferenceSession session;
    private readonly string[] dictionary;
    public EnglishMeterTextRecognizer(string directory)
    {
        Verify(Path.Combine(directory, "inference.onnx"), ModelSha256);
        Verify(Path.Combine(directory, "charset.json"), DictionarySha256);
        dictionary = JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(directory, "charset.json"), Encoding.UTF8))!;
        using var settings = new SessionOptions { IntraOpNumThreads = 2, InterOpNumThreads = 1,
            LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
        session = new InferenceSession(Path.Combine(directory, "inference.onnx"), settings);
        if (dictionary.Length != 438 || session.InputMetadata.Count != 1 ||
            session.InputMetadata.First().Value.Dimensions is not [_, 3, 48, _])
        { session.Dispose(); throw new InvalidDataException("Unsupported English meter model contract."); }
    }

    public (OcrLine Line, float MinimumCharacterScore) Recognize(Mat crop, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (crop.Empty() || crop.Type() != MatType.CV_8UC3) return (new("", 0), 0);
        var naturalWidth = (int)Math.Ceiling(48d * crop.Width / crop.Height);
        var width = Math.Max(320, naturalWidth);
        if (naturalWidth < 1 || width > 2048)
            return (new("", 0), 0);
        using var resized = new Mat(); Cv2.Resize(crop, resized, new(naturalWidth, 48));
        // Paddle RecResizeImg normalizes BGR before zero-padding the tensor.
        var tensor = new DenseTensor<float>(new[] { 1, 3, 48, width });
        try
        {
            for (var y = 0; y < 48; y++)
                for (var x = 0; x < naturalWidth; x++)
                {
                    var pixel = resized.At<Vec3b>(y, x);
                    for (var c = 0; c < 3; c++) tensor[0, c, y, x] = pixel[c] / 127.5f - 1;
                }
            using var run = new RunOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL };
            using var registration = token.Register(() => run.Terminate = true);
            using var outputs = session.Run([NamedOnnxValue.CreateFromTensor(session.InputNames[0], tensor)], session.OutputNames, run);
            token.ThrowIfCancellationRequested();
            var scores = outputs.First().AsTensor<float>();
            if (scores.Rank != 3 || scores.Dimensions[0] != 1 || scores.Dimensions[2] != dictionary.Length)
                throw new InvalidDataException("English meter dictionary contract mismatch.");
            var text = new StringBuilder(); var total = 0f; var minimum = 1f; var count = 0; var previous = 0;
            for (var step = 0; step < scores.Dimensions[1]; step++)
            {
                var best = 0;
                for (var i = 1; i < dictionary.Length; i++) if (scores[0, step, i] > scores[0, step, best]) best = i;
                if (best != 0 && best != previous)
                {
                    text.Append(dictionary[best]); count++;
                    total += scores[0, step, best]; minimum = Math.Min(minimum, scores[0, step, best]);
                }
                previous = best;
            }
            return (new(text.ToString().Trim(), count == 0 ? 0 : total / count), count == 0 ? 0 : minimum);
        }
        catch (OnnxRuntimeException) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
        finally { tensor.Buffer.Span.Clear(); resized.SetTo(Scalar.All(0)); }
    }

    private static void Verify(string path, string expected)
    {
        using var stream = File.OpenRead(path);
        if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("English meter artifact checksum mismatch.");
    }
    public void Dispose() => session.Dispose();
}
