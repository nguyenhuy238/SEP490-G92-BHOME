using System.Text.Json;
using BHome.Application.Ocr;
using OpenCvSharp;

internal static class IdentityChallengeFixtures
{
    // Only committed synthetic layouts are inputs. Variants are not independent people/cards.
    public static int Generate(string fixtures, string destination, bool validation = false)
    {
        Directory.CreateDirectory(destination);
        var cases = new List<EvaluationCase>();
        foreach (var side in new[] { "front", "back" })
        {
            using var original = Cv2.ImRead(Path.Combine(fixtures, "identity-chip", side + ".jpg"));
            if (original.Empty()) throw new InvalidDataException("Synthetic identity fixture unavailable.");
            var kind = side == "front" ? OcrDocumentKind.IdentityFront : OcrDocumentKind.IdentityBack;
            Dictionary<string, string> fields = side == "front"
                ? new() { ["citizenIdentityNumber"] = "000000000000", ["fullName"] = "NGƯỜI KIỂM THỬ", ["dateOfBirth"] = "2000-01-01" }
                : new() { ["dateOfIssue"] = "2024-07-01" };
            void Save(string variant, Mat frame)
            {
                var file = side + "-" + variant + ".jpg";
                Cv2.ImWrite(Path.Combine(destination, file), frame, new ImageEncodingParam(ImwriteFlags.JpegQuality, 92));
                cases.Add(new(file, kind, fields, Source: side));
            }
            if (validation)
            {
                using (var frame = Photo(original, -27))
                {
                    Cv2.GaussianBlur(frame, frame, new Size(0, 0), 1.4);
                    Save("rotate-minus27-blur", frame);
                }
                using (var frame = Photo(original, 75)) Save("rotate75", frame);
                using (var frame = Perspective(original))
                using (var kernel = new Mat(1, 5, MatType.CV_32F, Scalar.All(1d / 5)))
                {
                    Cv2.Filter2D(frame, frame, -1, kernel);
                    Save("perspective-motion5", frame);
                }
                continue;
            }
            Save("reference", original);
            foreach (var angle in new[] { -18, 18, 35, 60, 90, 180 })
            {
                using var frame = Photo(original, angle);
                Save("rotate" + angle, frame);
            }
            foreach (var sigma in new[] { 1.1, 1.8, 3.2 })
            {
                using var blurred = new Mat();
                Cv2.GaussianBlur(original, blurred, new Size(0, 0), sigma);
                Save("blur" + sigma.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture), blurred);
            }
            using (var dim = new Mat())
            {
                original.ConvertTo(dim, MatType.CV_8UC3, .32, 105);
                Save("low-contrast", dim);
            }
            using (var shadow = original.Clone())
            {
                for (var y = 0; y < shadow.Height; y++)
                    for (var x = 0; x < shadow.Width; x++)
                    {
                        var pixel = shadow.At<Vec3b>(y, x);
                        var light = .35 + .65 * x / shadow.Width;
                        shadow.Set(y, x, new Vec3b((byte)(pixel.Item0 * light), (byte)(pixel.Item1 * light), (byte)(pixel.Item2 * light)));
                    }
                Save("shadow", shadow);
            }
            using (var kernel = new Mat(1, 7, MatType.CV_32F, Scalar.All(1d / 7)))
            using (var motion = new Mat())
            {
                Cv2.Filter2D(original, motion, -1, kernel);
                Save("motion7", motion);
            }
            using (var perspective = Perspective(original))
            {
                Save("perspective", perspective);
                Cv2.GaussianBlur(perspective, perspective, new Size(0, 0), 1.2);
                Save("perspective-blur", perspective);
            }
        }
        using (var blank = Cv2.ImRead(Path.Combine(fixtures, "identity-chip", "blank-front.jpg")))
        {
            using var frame = Photo(blank, 18);
            Cv2.ImWrite(Path.Combine(destination, "blank.jpg"), frame);
            cases.Add(new("blank.jpg", OcrDocumentKind.IdentityFront, new Dictionary<string, string>(), ExpectFallback: true, Source: "blank"));
        }
        File.WriteAllText(Path.Combine(destination, "manifest.json"), JsonSerializer.Serialize(new EvaluationManifest("synthetic", cases), OcrEvaluation.Json));
        Console.WriteLine($"Generated {cases.Count} synthetic challenge cases from two populated layouts and one blank layout.");
        return 0;
    }

    private static Mat Photo(Mat card, double angle)
    {
        using var scaled = new Mat();
        Cv2.Resize(card, scaled, new Size(1400, 875));
        using var scene = new Mat(2000, 2200, MatType.CV_8UC3, new Scalar(65, 74, 85));
        using (var inset = new Mat(scene, new Rect(400, 562, scaled.Width, scaled.Height))) scaled.CopyTo(inset);
        using var transform = Cv2.GetRotationMatrix2D(new Point2f(1100, 1000), angle, 1);
        var result = new Mat();
        Cv2.WarpAffine(scene, result, transform, scene.Size(), InterpolationFlags.Linear, BorderTypes.Constant, new Scalar(65, 74, 85));
        return result;
    }

    private static Mat Perspective(Mat card)
    {
        Point2f[] source = [new(0, 0), new(card.Width - 1, 0), new(card.Width - 1, card.Height - 1), new(0, card.Height - 1)];
        Point2f[] target = [new(220, 280), new(1700, 160), new(1620, 1190), new(330, 1300)];
        using var transform = Cv2.GetPerspectiveTransform(source, target);
        var result = new Mat();
        Cv2.WarpPerspective(card, result, transform, new Size(2000, 1600), InterpolationFlags.Linear, BorderTypes.Constant, new Scalar(65, 74, 85));
        return result;
    }
}
