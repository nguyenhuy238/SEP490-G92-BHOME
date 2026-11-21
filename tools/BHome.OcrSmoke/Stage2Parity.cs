using System.Text.Json;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

internal static class Stage2Parity
{
    public static int Run(string models, string crops, string report)
    {
        using var native = JsonDocument.Parse(File.ReadAllText(Path.Combine(models, "native-stage2-parity.json")));
        using var session = new InferenceSession(Path.Combine(models, YoloWaterDigitRecognizer.FileName));
        var rows = new List<object>(); var all = true;
        foreach (var sample in native.RootElement[0].GetProperty("samples").EnumerateArray())
        {
            var file = sample.GetProperty("file").GetString()!;
            using var image = Cv2.ImRead(Path.Combine(crops, file));
            var input = YoloMeterSceneDetector.Letterbox(image, out var scale, out var left, out var top, size: 416);
            var prefix = Path.Combine(models, "water-stage2.pt." + Path.GetFileNameWithoutExtension(file));
            var inputReference = Floats(prefix + ".input.f32");
            var delta = input.Buffer.Span.ToArray().Zip(inputReference, (a, b) => Math.Abs(a - b)).Max();
            using var result = session.Run([NamedOnnxValue.CreateFromTensor(session.InputNames[0], input)]);
            var boxes = YoloMeterSceneDetector.Decode(result.First().AsTensor<float>(), image.Size(), scale, left, top, .35f, .45f, digits: true);
            var expected = sample.GetProperty("detections").EnumerateArray().ToArray();
            var match = boxes.Count == expected.Length && expected.All(n => boxes.Any(b =>
            {
                if (b.ClassId != n.GetProperty("classId").GetInt32() || Math.Abs(b.Confidence - n.GetProperty("confidence").GetSingle()) > .002) return false;
                var p = n.GetProperty("xywhr");
                var pose = new RotatedRect(new(p[0].GetSingle(), p[1].GetSingle()), new(p[2].GetSingle(), p[3].GetSingle()), p[4].GetSingle() * 180f / MathF.PI);
                return b.Box.Points().All(a => pose.Points().Any(q => Math.Abs(a.X - q.X) < .1 && Math.Abs(a.Y - q.Y) < .1));
            }));
            input.Buffer.Span.Clear(); all &= match && delta <= 1e-6;
            rows.Add(new { file, inputMaxDelta = delta, nativeDetectionParity = match, nativeDetections = expected.Length, dotnetDetections = boxes.Count });
        }
        File.WriteAllText(report, JsonSerializer.Serialize(new { passed = all, rows }, OcrEvaluation.Json));
        Console.WriteLine($"Stage2 .NET/native parity: {all}, {rows.Count} crops");
        return all ? 0 : 1;
    }
    private static float[] Floats(string path) { var bytes = File.ReadAllBytes(path); var values = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, values, 0, bytes.Length); return values; }
}
