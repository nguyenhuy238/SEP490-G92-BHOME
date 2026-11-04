using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Optional in-process model adapter. No implementation is registered until licensed,
// meter-specific weights and a held-out evaluation are available. Coordinates refer
// to the supplied prepared image (not the original upload or a letterboxed tensor).
// Return all plausible, post-NMS meters; never return only the highest scoring one.
public interface IMeterSceneDetector
{
    MeterScene Detect(Mat image, CancellationToken token);
}

public sealed record MeterScene(bool IsAvailable, IReadOnlyList<DetectedMeter> Meters);
public sealed record DetectedMeter(Rect Bounds, float Confidence,
    OcrDocumentKind? Category = null, float? CategoryConfidence = null,
    IReadOnlyList<DetectedReadingRegion>? ReadingRegions = null);
public sealed record DetectedReadingRegion(Rect Bounds, float Confidence);

public sealed record MeterSceneSelection(Rect? Crop, bool CanRecognize, IReadOnlyList<string> Warnings)
{
    // Null ReadingRegions means the adapter cannot detect displays; an empty list
    // means it did run and found no display. Only the former uses legacy text OCR.
    public static MeterSceneSelection Select(MeterScene? scene, Size imageSize,
        OcrDocumentKind knownKind, float minimumConfidence)
    {
        if (scene is null || !scene.IsAvailable)
            return new(null, true, ["meter_localization_unavailable", "reading_region_unverified"]);
        if (scene.Meters.Count == 0) return Reject("meter_not_detected");
        if (scene.Meters.Count != 1) return Reject("multiple_meters");
        var meter = scene.Meters[0];
        var image = new Rect(0, 0, imageSize.Width, imageSize.Height);
        if (!Inside(meter.Bounds, image)) return Reject("meter_region_invalid");
        if (!Confident(meter.Confidence, minimumConfidence)) return Reject("meter_detection_uncertain");
        var warnings = new List<string>();
        if (meter.Category is { } category && meter.CategoryConfidence is { } confidence &&
            Confident(confidence, minimumConfidence))
        {
            if (category != knownKind) return Reject("meter_type_mismatch");
        }
        else warnings.Add("meter_category_unverified"); // trusted server metadata remains authoritative
        if (meter.ReadingRegions is null)
            return new(meter.Bounds, true, [.. warnings, "reading_region_unverified"]);
        if (meter.ReadingRegions.Count == 0) return Reject("reading_region_not_detected");
        if (meter.ReadingRegions.Count != 1) return Reject("ambiguous_reading");
        var display = meter.ReadingRegions[0];
        if (!Inside(display.Bounds, meter.Bounds)) return Reject("meter_region_invalid");
        if (!Confident(display.Confidence, minimumConfidence)) return Reject("reading_region_uncertain");
        // Detecting a display does not identify a digital tariff/register screen.
        if (knownKind is OcrDocumentKind.DigitalElectricity or OcrDocumentKind.DigitalWater)
            warnings.Add("billing_register_unverified");
        return new(display.Bounds, true, warnings);
    }

    private static bool Confident(float value, float minimum) => float.IsFinite(value) && value >= minimum && value <= 1;
    private static bool Inside(Rect inner, Rect outer) => inner.Width > 0 && inner.Height > 0 &&
        inner.X >= outer.X && inner.Y >= outer.Y &&
        (long)inner.X + inner.Width <= (long)outer.X + outer.Width &&
        (long)inner.Y + inner.Height <= (long)outer.Y + outer.Height;
    private static MeterSceneSelection Reject(string warning) => new(null, false, [warning]);
}
