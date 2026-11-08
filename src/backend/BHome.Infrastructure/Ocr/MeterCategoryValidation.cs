using BHome.Application.Ocr;

namespace BHome.Infrastructure.Ocr;

// Visual evidence validates a trusted task kind; it never changes task metadata.
public static class MeterCategoryValidation
{
    public static (bool CanRecognize, IReadOnlyList<string> Warnings) Check(
        OcrCategoryDecision? visual, OcrDocumentKind expected, float minimumConfidence)
    {
        if (visual is null) return (true, []);
        var overlappingWeak = visual.Source == "visual_model" && visual.Status == "ambiguous" && visual.Kind is null &&
            (visual.Warnings ?? []).Contains("overlapping_category_hypotheses") &&
            visual.Confidence is { } weakScore && float.IsFinite(weakScore) && weakScore > 0 && weakScore < minimumConfidence;
        if ((visual.Warnings ?? []).Any(w => w is "multiple_meters" or "multiple_reading_regions" or "ambiguous_reading") ||
            (visual.Candidates is { Count: > 1 } && !overlappingWeak)) return (false, ["multiple_meters"]);
        if (visual.Status == "classified" && visual.Kind is { } actual && Enum.IsDefined(actual) &&
            visual.Confidence is { } confidence && float.IsFinite(confidence) && confidence >= minimumConfidence && confidence <= 1)
            return actual == expected ? (true, []) : (false, ["meter_type_mismatch"]);
        return (true, [.. visual.Warnings ?? [], "meter_category_unverified"]);
    }
}
