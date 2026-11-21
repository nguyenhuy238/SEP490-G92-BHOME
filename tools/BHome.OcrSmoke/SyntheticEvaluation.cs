using System.Text.Json;
using BHome.Application.Ocr;
using OpenCvSharp;

internal static class SyntheticEvaluation
{
    public static void Generate(string fixtureDirectory, string destination)
    {
        Directory.CreateDirectory(destination);
        var samples = new[]
        {
            new EvaluationCase("identity-front.png", OcrDocumentKind.IdentityFront, new Dictionary<string, string>
            { ["citizenIdentityNumber"] = "000000000000", ["fullName"] = "NGƯỜI KIỂM THỬ", ["dateOfBirth"] = "2000-01-01" }),
            new EvaluationCase("identity-back-layout.png", OcrDocumentKind.IdentityBack, new Dictionary<string, string> { ["dateOfIssue"] = "2020-02-01" }),
            new EvaluationCase("identity-back-2024.png", OcrDocumentKind.IdentityBack, new Dictionary<string, string> { ["dateOfIssue"] = "2024-07-01" }),
            new EvaluationCase("electricity-mechanical.png", OcrDocumentKind.MechanicalElectricity, new Dictionary<string, string> { ["reading"] = "00123.45" }),
            new EvaluationCase("electricity-digital.png", OcrDocumentKind.DigitalElectricity, new Dictionary<string, string> { ["reading"] = "00123.45" }),
            new EvaluationCase("water-mechanical.png", OcrDocumentKind.MechanicalWater, new Dictionary<string, string> { ["reading"] = "00123.45" }),
            new EvaluationCase("water-digital.png", OcrDocumentKind.DigitalWater, new Dictionary<string, string> { ["reading"] = "00123.45" }),
            new EvaluationCase("identity-front-layout.png", OcrDocumentKind.IdentityFront, new Dictionary<string, string>
            {
                ["citizenIdentityNumber"] = "000000000000", ["fullName"] = "NGƯỜI KIỂM THỬ", ["dateOfBirth"] = "2000-01-01",
                ["gender"] = "Nữ", ["nationality"] = "Việt Nam", ["residentialAddress"] = "THÔN GIẢ LẬP XÃ KIỂM THỬ, TỈNH MÔ PHỎNG"
            }),
            new EvaluationCase("identity-back-residence.png", OcrDocumentKind.IdentityBack, new Dictionary<string, string>
            { ["dateOfIssue"] = "2024-07-01", ["residentialAddress"] = "THÔN GIẢ LẬP XÃ KIỂM THỬ, TỈNH MÔ PHỎNG" }),
            new EvaluationCase("electricity-mechanical-wheels.png", OcrDocumentKind.MechanicalElectricity,
                new Dictionary<string, string> { ["reading"] = "00456.78" }, DecimalPlaces: 2),
            new EvaluationCase("water-mechanical-wheels.png", OcrDocumentKind.MechanicalWater,
                new Dictionary<string, string> { ["reading"] = "00987.654" }, DecimalPlaces: 3),
            new EvaluationCase("electricity-digital-lcd.png", OcrDocumentKind.DigitalElectricity,
                new Dictionary<string, string> { ["reading"] = "073219.4" }, DecimalPlaces: 1),
            new EvaluationCase("water-digital-lcd.png", OcrDocumentKind.DigitalWater,
                new Dictionary<string, string> { ["reading"] = "000432.1" }, DecimalPlaces: 1)
        };
        var cases = new List<EvaluationCase>();
        foreach (var sample in samples)
        {
            using var source = Cv2.ImRead(Path.Combine(fixtureDirectory, sample.File));
            if (source.Empty()) throw new InvalidDataException();
            foreach (var variant in new[] { "original", "tilt", "perspective", "dim", "jpeg", "90", "180", "270" })
            {
                using var image = Variant(source, variant);
                var file = $"{sample.Kind}-{Path.GetFileNameWithoutExtension(sample.File)}-{variant}.png";
                Cv2.ImWrite(Path.Combine(destination, file), image);
                cases.Add(sample with { File = file, Source = sample.File });
            }
        }
        using var blank = new Mat(400, 600, MatType.CV_8UC3, Scalar.All(200));
        Cv2.ImWrite(Path.Combine(destination, "blank.png"), blank);
        foreach (var kind in Enum.GetValues<OcrDocumentKind>())
            cases.Add(new("blank.png", kind, new Dictionary<string, string>(), true));
        File.WriteAllText(Path.Combine(destination, "manifest.json"),
            JsonSerializer.Serialize(new EvaluationManifest("synthetic", cases), OcrEvaluation.Json));
        Console.WriteLine(JsonSerializer.Serialize(new { stage = "generated", dataset = "synthetic", cases = cases.Count }));
    }

    private static Mat Variant(Mat source, string variant)
    {
        var result = new Mat();
        switch (variant)
        {
            case "90": Cv2.Rotate(source, result, RotateFlags.Rotate90Clockwise); break;
            case "180": Cv2.Rotate(source, result, RotateFlags.Rotate180); break;
            case "270": Cv2.Rotate(source, result, RotateFlags.Rotate90Counterclockwise); break;
            case "dim": source.ConvertTo(result, -1, .45, 60); break;
            case "jpeg":
                var bytes = source.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 55));
                try { using var decoded = Cv2.ImDecode(bytes, ImreadModes.Color); decoded.CopyTo(result); }
                finally { Array.Clear(bytes); }
                break;
            case "tilt":
                using (var transform = Cv2.GetRotationMatrix2D(new Point2f(source.Width / 2f, source.Height / 2f), 8, .9))
                    Cv2.WarpAffine(source, result, transform, source.Size(), InterpolationFlags.Linear, BorderTypes.Constant, Scalar.White);
                break;
            case "perspective":
                Point2f[] corners = [new(0, 0), new(source.Width - 1, 0), new(source.Width - 1, source.Height - 1), new(0, source.Height - 1)];
                Point2f[] projected = [new(35, 20), new(source.Width - 35, 45), new(source.Width - 10, source.Height - 30), new(10, source.Height - 10)];
                using (var transform = Cv2.GetPerspectiveTransform(corners, projected))
                    Cv2.WarpPerspective(source, result, transform, source.Size(), InterpolationFlags.Linear, BorderTypes.Constant, Scalar.White);
                break;
            default: source.CopyTo(result); break;
        }
        return result;
    }
}
