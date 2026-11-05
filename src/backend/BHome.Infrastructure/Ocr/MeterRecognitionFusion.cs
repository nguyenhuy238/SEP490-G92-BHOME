using BHome.Application.Ocr;

namespace BHome.Infrastructure.Ocr;

internal static class MeterRecognitionFusion
{
    public static OcrText Combine(OcrText pp, MeterDigitResult digits)
    {
        // Missing/corrupt secondary model preserves PP with an explicit warning.
        if (digits.Warnings.Contains("digit_model_unavailable"))
            return pp with { Warnings = [.. pp.Warnings, .. digits.Warnings] };
        if (digits.Digits is null || digits.Confidence is not { } score || !float.IsFinite(score) || score is < .5f or > 1)
            return new([], pp.EngineVersion, [.. pp.Warnings, .. digits.Warnings, "reading_not_recognized"]);
        if (pp.Warnings.Any(w => w is "conflicting_reading" or "orientation_uncertain" or "text_region_limit" or "blur_or_low_detail"))
            return new([], pp.EngineVersion, [.. pp.Warnings, "recognizer_conflict"]);
        var proposal = OcrFieldParser.Parse(pp, OcrDocumentKind.MechanicalWater);
        var value = proposal.ProposedFields.GetValueOrDefault("reading");
        // A single malformed CTC line is not a competing numeric reading. On the
        // author validation set, the already-guarded digit model can supply a
        // review-only proposal here. Multiple regions, type contradictions and
        // valid numeric disagreements remain hard rejections.
        if (proposal.Warnings.Any(w => w is "multiple_reading_regions" or "meter_type_mismatch") ||
            (proposal.Warnings.Contains("ambiguous_reading") && pp.Lines.Count != 1))
            return new([], pp.EngineVersion, [.. proposal.Warnings, "recognizer_conflict"]);
        // Digit checkpoint has no decimal class. Compare characters without
        // discarding leading zeros; preserve an observed PP separator on agreement.
        if (value is not null && value.Replace(".", "", StringComparison.Ordinal) != digits.Digits)
            return new([], pp.EngineVersion, [.. pp.Warnings, "recognizer_conflict"]);
        var agreed = value ?? digits.Digits;
        var warnings = pp.Warnings.Where(w => w != "no_text").ToList();
        warnings.Add(value is null ? "stage2_only_review" : "recognizers_agree");
        if (value is null) warnings.Add("decimal_separator_unverified");
        return new([new(agreed, value is null ? score : Math.Min(score, proposal.Confidence.GetValueOrDefault("reading")))], pp.EngineVersion, warnings);
    }
}
