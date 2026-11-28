using System.Text.Json;
using BHome.Application.Ocr;
using OpenCvSharp;

internal static class IdentityChipCameraFixtures
{
    public static int Generate(string source, string destination, string[]? conditions = null)
    {
        Directory.CreateDirectory(destination);
        var expectedPath = Path.Combine(source, "expected.json");
        var expectations = File.Exists(expectedPath)
            ? JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(File.ReadAllText(expectedPath)) : null;
        var cases = new List<EvaluationCase>();
        foreach (var side in new[] { "front", "back", "blank-front" })
        {
            using var card = Cv2.ImRead(Path.Combine(source, side + ".png"));
            if (card.Empty()) throw new InvalidDataException("Synthetic fixture unavailable.");
            foreach (var condition in conditions ?? ["straight", "far", "tilt", "perspective", "dim", "soft", "combined"])
            {
                using var print = card.Clone();
                if (condition is "dim" or "combined") print.ConvertTo(print, MatType.CV_8UC3, .42, 3);
                if (condition is "soft" or "combined") Cv2.GaussianBlur(print, print, new Size(5, 5), 1.2);
                var width = condition == "far" ? 420 : 650;
                using var scene = IdentityDeskFixtures.Scene(print, width, condition is "tilt" or "combined" ? 17 : 0);
                using var warped = new Mat();
                if (condition is "perspective" or "combined")
                {
                    Point2f[] from = [new(0, 0), new(959, 0), new(959, 1279), new(0, 1279)];
                    Point2f[] to = [new(80, 60), new(900, 0), new(959, 1279), new(0, 1190)];
                    using var transform = Cv2.GetPerspectiveTransform(from, to);
                    Cv2.WarpPerspective(scene, warped, transform, scene.Size(), borderMode: BorderTypes.Reflect101);
                }
                else scene.CopyTo(warped);
                var file = $"{side}-{condition}.jpg";
                Cv2.ImWrite(Path.Combine(destination, file), warped, new ImageEncodingParam(ImwriteFlags.JpegQuality, 90));
                Dictionary<string, string> expected = side switch
                {
                    "front" => new()
                    {
                        ["citizenIdentityNumber"] = "000000001234",
                        ["fullName"] = "NGƯỜI THỬ NGHIỆM",
                        ["dateOfBirth"] = "2001-03-12",
                        ["gender"] = "Nam",
                        ["nationality"] = "Việt Nam",
                        ["placeOfOrigin"] = "Xã Giả Lập, Huyện Mô Phỏng",
                        ["residentialAddress"] = "Thôn Thử Xã Kiểm Thử, Tỉnh Giả Lập",
                        ["dateOfExpiry"] = "2031-03-12"
                    },
                    "back" => new() { ["dateOfIssue"] = "2023-06-14" },
                    _ => new()
                };
                if (side != "blank-front" && expectations?.TryGetValue(side, out var specified) == true) expected = specified;
                cases.Add(new(file, side == "back" ? OcrDocumentKind.IdentityBack : OcrDocumentKind.IdentityFront,
                    expected, ExpectFallback: side == "blank-front", Source: side));
            }
        }
        File.WriteAllText(Path.Combine(destination, "manifest.json"), JsonSerializer.Serialize(new EvaluationManifest("synthetic", cases), OcrEvaluation.Json));
        Console.WriteLine($"Generated {cases.Count} synthetic chip-layout camera cases.");
        return 0;
    }

    public static int GenerateCorpus(string source, string destination)
    {
        var cases = new List<EvaluationCase>();
        for (var variant = 0; variant < 6; variant++)
        {
            var folder = "case-" + variant;
            var output = Path.Combine(destination, folder);
            Generate(Path.Combine(source, folder), output, ["straight", "dim", "combined"]);
            var manifest = JsonSerializer.Deserialize<EvaluationManifest>(File.ReadAllText(Path.Combine(output, "manifest.json")), OcrEvaluation.Json)!;
            cases.AddRange(manifest.Cases.Select(sample => sample with { File = folder + "/" + sample.File, Source = folder + "/" + sample.Source }));
        }
        File.WriteAllText(Path.Combine(destination, "manifest.json"), JsonSerializer.Serialize(new EvaluationManifest("synthetic", cases), OcrEvaluation.Json));
        return 0;
    }
}
