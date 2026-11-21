using System.Security.Cryptography;
using System.Text.Json;
using BHome.Infrastructure.Ocr;
using BHome.Application.Ocr;
using OpenCvSharp;

// Caller-supplied public evaluation manifest only; never attached to API logging.
internal static class ExperimentalMeterContext
{
    public static async Task<int> Run(string models, string english, string manifest, string root, string output, int maximumEdge = 1280)
    {
        Directory.CreateDirectory(output);
        using var input = JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options = new OcrOptions { ModelDirectory = models };
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var reader = new EnglishMeterTextRecognizer(english); var rows = new List<object>();
        foreach (var sample in input.RootElement.GetProperty("samples").EnumerateArray())
        {
            var path = Path.GetFullPath(Path.Combine(root, sample.GetProperty("image").GetString()!));
            if (!path.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                !Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))).Equals(sample.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Public source changed.");
            using var prepared = new ImagePreprocessor(options).PrepareUnclassified(await File.ReadAllBytesAsync(path)); var image = prepared.Image;
            var lines = new List<object>(); var evidence = new List<OcrLine>(); var index = 0;
            var detected = engine.InspectTextRegions(image, maximumEdge, default).Take(48).ToArray();
            var regions = detected.Select(r => r.BoundingRect().Intersect(new Rect(0, 0, image.Width, image.Height))).ToArray();
            foreach (var region in detected)
            {
                var bounds = region.BoundingRect().Intersect(new Rect(0, 0, image.Width, image.Height));
                if (bounds.Width < 2 || bounds.Height < 2) continue;
                using var crop = new Mat(image, bounds); var line = reader.Recognize(crop, default).Line;
                evidence.Add(line with { Bounds = new(bounds.X, bounds.Y, bounds.Width, bounds.Height) });
                var expanded = ExperimentalMeterRecognizer.ExpandNumericRow(bounds, regions, image.Size());
                using var expandedImage = new Mat(image, expanded); var alternate = reader.Recognize(expandedImage, default).Line;
                var file = sample.GetProperty("id").GetString() + "-" + (index++) + ".png"; Cv2.ImWrite(Path.Combine(output, file), expandedImage);
                var pp = engine.InspectMeterCrop(crop, true, default).Lines.First();
                using var oriented = OnnxOcrEngine.Crop(image, region);
                var rectified = reader.Recognize(oriented, default);
                var rectifiedPp = engine.InspectMeterCrop(oriented, true, default).Lines.First();
                using var direct = OnnxOcrEngine.Crop(image, region, 48);
                var directText = reader.Recognize(direct, default);
                lines.Add(new { line.Text, line.Confidence, ppRaw = pp.Text, ppConfidence = pp.Confidence, bounds = new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }, expanded = alternate.Text, oriented = rectified.Line.Text, orientedConfidence = rectified.Line.Confidence, orientedMinimumScore = rectified.MinimumCharacterScore, direct = directText.Line.Text, directConfidence = directText.Line.Confidence, directMinimumScore = directText.MinimumCharacterScore, orientedPp = rectifiedPp.Text, orientedPpConfidence = rectifiedPp.Confidence, angle = region.Angle, activeInk = ExperimentalMeterRecognizer.HasActiveInk(expandedImage), crop = file });
            }
            // Isolate register evidence independently of the classifier's guess.
            // This controlled probe is not a new category prediction.
            var registerGate = ExperimentalRegisterSelection.Select(OcrDocumentKind.DigitalElectricity, evidence);
            var groupedRows = new List<object>();
            foreach (var box in NumericFragmentRows(evidence))
            {
                using var crop = new Mat(image, box);
                var observed = reader.Recognize(crop, default);
                var pp = engine.InspectMeterCrop(crop, true, default);
                groupedRows.Add(new
                {
                    bounds = new[] { box.X, box.Y, box.Width, box.Height },
                    observed.Line.Text,
                    observed.Line.Confidence,
                    observed.MinimumCharacterScore,
                    pp = pp.Lines.Select(l => new { l.Text, l.Confidence }),
                    registerVerified = false,
                    billingValueProduced = false
                });
            }
            rows.Add(new { id = sample.GetProperty("id").GetString(), lines, registerGate, groupedRows });
        }
        await File.WriteAllTextAsync(Path.Combine(output, "context.json"), JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true })); return 0;
    }

    // Component analysis only: join geometry, then recognize actual union pixels.
    // Never concatenate OCR strings; a complete numeric observation alone is not
    // a register/unit/precision claim and this helper is not in application DI.
    private static IReadOnlyList<Rect> NumericFragmentRows(IReadOnlyList<OcrLine> lines)
    {
        var fragments = lines.Where(l => l.Bounds is not null && l.Confidence >= .5f && l.Text.Length > 0 &&
            l.Text.All(c => c is >= '0' and <= '9')).ToList();
        var result = new List<Rect>();
        while (fragments.Count > 0)
        {
            var group = new List<OcrLine> { fragments[0] }; fragments.RemoveAt(0);
            bool added;
            do
            {
                added = false;
                for (var i = fragments.Count - 1; i >= 0; i--)
                {
                    var b = fragments[i].Bounds!;
                    if (!group.Any(l =>
                    {
                        var a = l.Bounds!; var height = Math.Max(a.Height, b.Height);
                        var gap = Math.Max(a.X - b.X - b.Width, b.X - a.X - a.Width);
                        return Math.Min(a.Height, b.Height) >= height * .5f &&
                            Math.Abs(a.Y + a.Height / 2 - b.Y - b.Height / 2) <= height * .6f && gap <= height * .8f;
                    })) continue;
                    group.Add(fragments[i]); fragments.RemoveAt(i); added = true;
                }
            } while (added);
            if (group.Count < 2) continue;
            var left = group.Min(l => l.Bounds!.X); var right = group.Max(l => l.Bounds!.X + l.Bounds.Width);
            var top = group.Min(l => l.Bounds!.Y); var bottom = group.Max(l => l.Bounds!.Y + l.Bounds.Height);
            if (lines.Except(group).Any(l => l.Bounds is { } b && b.X + b.Width / 2 > left && b.X + b.Width / 2 < right &&
                b.Y + b.Height / 2 > top && b.Y + b.Height / 2 < bottom)) continue;
            result.Add(new((int)left, (int)top, (int)(right - left), (int)(bottom - top)));
        }
        return result;
    }
}
