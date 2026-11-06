using System.Text.Json;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

internal static class DigitCropProbe
{
    public static int Run(string models, string yolo, string crops, string report)
    {
        var options = new OcrOptions { ModelDirectory = models, MeterDetector = new() { ModelDirectory = yolo } };
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var digits = new YoloWaterDigitRecognizer(options);
        var rows = new List<object>();
        foreach (var file in Directory.GetFiles(crops, "*-legacy.png").Order())
        {
            using var image = Cv2.ImRead(file);
            var result = digits.Recognize(image, default);
            var text = new List<string>(); var scores = new List<float>();
            if (result.Digits is not null)
                foreach (var box in result.Detections.OrderBy(b => b.Box.Center.X))
                {
                    var bounds = box.Box.BoundingRect().Intersect(new Rect(0, 0, image.Width, image.Height));
                    using var crop = new Mat(image, bounds);
                    var line = engine.InspectMeterCrop(crop, true, default).Lines.Single();
                    text.Add(line.Text); scores.Add(line.Confidence);
                }
            rows.Add(new { file = Path.GetFileName(file), stage2 = result.Digits, ppDigits = string.Concat(text), scores });
        }
        File.WriteAllText(report, JsonSerializer.Serialize(rows, OcrEvaluation.Json));
        return 0;
    }
}
