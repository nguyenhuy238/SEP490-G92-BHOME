using System.Text.Json;
using BHome.Application.Ocr;
using OpenCvSharp;

internal static class IdentityDeskFixtures
{
    // Procedural desk grain and synthetic cards only; never copy a real identity.
    public static int Generate(string fixtureRoot, string destination, bool dense = false)
    {
        Directory.CreateDirectory(destination);
        var cases = new List<EvaluationCase>();
        foreach (var side in new[] { "front", "back" })
        {
            using var card = Cv2.ImRead(Path.Combine(fixtureRoot, dense ? "identity-desk-layout" : "identity-chip", side + (dense ? ".png" : ".jpg")));
            if (card.Empty()) throw new InvalidDataException("Synthetic identity fixture unavailable.");
            foreach (var width in new[] { 600, 800 })
                foreach (var angle in new[] { 0, 8 })
                    foreach (var shadow in new[] { false, true })
                    {
                        using var print = card.Clone();
                        if (shadow) print.ConvertTo(print, MatType.CV_8UC3, .6, 5);
                        using var image = Scene(print, width, angle);
                        var file = $"{side}-{width}-{angle}{(shadow ? "-dim" : "")}.jpg";
                        Cv2.ImWrite(Path.Combine(destination, file), image, new ImageEncodingParam(ImwriteFlags.JpegQuality, 93));
                        Dictionary<string, string> fields = dense ? side == "front"
                            ? new() { ["citizenIdentityNumber"] = "000000001234", ["fullName"] = "NGƯỜI THỬ NGHIỆM", ["dateOfBirth"] = "2001-03-12" }
                            : new() { ["dateOfIssue"] = "2023-06-14" } : side == "front"
                            ? new() { ["citizenIdentityNumber"] = "000000000000", ["fullName"] = "NGƯỜI KIỂM THỬ", ["dateOfBirth"] = "2000-01-01" }
                            : new() { ["dateOfIssue"] = "2024-07-01" };
                        cases.Add(new(file, side == "front" ? OcrDocumentKind.IdentityFront : OcrDocumentKind.IdentityBack, fields, Source: side));
                    }
        }
        using (var blank = Cv2.ImRead(Path.Combine(fixtureRoot, dense ? "identity-desk-layout" : "identity-chip", dense ? "blank-front.png" : "blank-front.jpg")))
        using (var image = Scene(blank, 600, 8))
        {
            Cv2.ImWrite(Path.Combine(destination, "blank.jpg"), image);
            cases.Add(new("blank.jpg", OcrDocumentKind.IdentityFront, new Dictionary<string, string>(), ExpectFallback: true, Source: "blank"));
        }
        File.WriteAllText(Path.Combine(destination, "manifest.json"), JsonSerializer.Serialize(new EvaluationManifest("synthetic", cases), OcrEvaluation.Json));
        Console.WriteLine($"Generated {cases.Count} synthetic desk cases from two populated layouts and a blank layout.");
        return 0;
    }

    internal static Mat Scene(Mat card, int width, double angle)
    {
        using var scene = Desk();
        using var resized = new Mat();
        Cv2.Resize(card, resized, new Size(width, width * card.Height / card.Width), 0, 0, InterpolationFlags.Area);
        using var mask = new Mat(resized.Size(), MatType.CV_8UC1, Scalar.Black);
        const int radius = 18;
        Cv2.Rectangle(mask, new Rect(radius, 0, mask.Width - radius * 2, mask.Height), Scalar.White, -1);
        Cv2.Rectangle(mask, new Rect(0, radius, mask.Width, mask.Height - radius * 2), Scalar.White, -1);
        foreach (var center in new[] { new Point(radius, radius), new(mask.Width - radius - 1, radius),
            new(radius, mask.Height - radius - 1), new(mask.Width - radius - 1, mask.Height - radius - 1) })
            Cv2.Circle(mask, center, radius, Scalar.White, -1);
        using (var inset = new Mat(scene, new Rect((scene.Width - width) / 2, 350, resized.Width, resized.Height))) resized.CopyTo(inset, mask);
        using var transform = Cv2.GetRotationMatrix2D(new Point2f(480, 640), angle, 1);
        var result = new Mat();
        Cv2.WarpAffine(scene, result, transform, scene.Size(), InterpolationFlags.Linear, BorderTypes.Reflect101);
        return result;
    }

    internal static Mat Desk()
    {
        var image = new Mat(1280, 960, MatType.CV_8UC3);
        var random = new Random(248);
        for (var y = 0; y < image.Height; y++)
            for (var x = 0; x < image.Width; x++)
            {
                var grain = 58 + 23 * Math.Sin((y + x * .58) * 2.1) + 18 * Math.Sin((y + x * .61) * .55) + random.Next(-14, 15);
                var value = (byte)Math.Clamp(grain, 0, 255);
                image.Set(y, x, new Vec3b(value, (byte)(value * 1.1), (byte)(value * 1.2)));
            }
        return image;
    }
}
