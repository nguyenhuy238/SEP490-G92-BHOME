using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

public sealed record OcrCategoryDecision(string Status, OcrDocumentKind? Kind, string Source,
    float? Confidence = null, IReadOnlyList<OcrDocumentKind>? Candidates = null,
    IReadOnlyList<string>? Warnings = null);
public sealed record OcrImageAnalysis(OcrText Text, OcrCategoryDecision? VisualDecision = null);

public interface IOcrAnalysisEngine
{
    // Neutral text analysis: no assumed front/back, utility or display technology.
    Task<OcrImageAnalysis> AnalyzeAsync(ReadOnlyMemory<byte> image, CancellationToken token);
}

public interface IAutomaticOcrService
{
    Task<AutomaticOcrResult> ExtractAutomaticAsync(Stream temporaryInput, CancellationToken token);
}

public sealed record AutomaticOcrResult(string ClassificationStatus, string DetectedCategory,
    float? ClassificationConfidence, string ClassificationSource, IReadOnlyList<string> CandidateCategories,
    IReadOnlyList<string> Warnings, OcrProposal? IdentityProposal = null, OcrProposal? MeterProposal = null)
{
    public bool RequiresReview => true;
    public override string ToString() => "Automatic OCR result (sensitive fields omitted)";
}

public static class OcrCategories
{
    public static string Name(OcrDocumentKind kind) => kind switch
    {
        OcrDocumentKind.IdentityFront => "cccd_front",
        OcrDocumentKind.IdentityBack => "cccd_back",
        OcrDocumentKind.MechanicalElectricity => "electricity_mechanical",
        OcrDocumentKind.DigitalElectricity => "electricity_digital",
        OcrDocumentKind.MechanicalWater => "water_mechanical",
        OcrDocumentKind.DigitalWater => "water_digital",
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };
}

// Conservative evidence rules, NOT a trained visual classifier or calibrated probability.
public static class OcrCategoryRules
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    public static OcrCategoryDecision Evaluate(OcrText text)
    {
        if (text.Warnings.Any(w => w is "text_region_limit" or "orientation_uncertain" or "blur_or_low_detail"))
            return new("unknown", null, "text_rules", Warnings: ["classification_insufficient_evidence"]);
        var lines = text.Lines.Where(line => float.IsFinite(line.Confidence) && line.Confidence is >= .9f and <= 1)
            .Select(line => OcrFieldParser.FoldLabels(line.Text).ToLowerInvariant()).ToArray();
        bool Has(string pattern) => lines.Any(line => Regex.IsMatch(line, pattern, RegexOptions.CultureInvariant, Timeout));
        var front = Has(@"(?:can cuoc|identity card)") && Has(@"(?:ho va ten|full name)") &&
            Has(@"(?:ngay sinh|date of birth)") && Has(@"(?<!\d)[0-9]{12}(?!\d)");
        var back = Has(@"(?:ngay cap|date of issue|ngay,?\s*thang,?\s*nam|date,?\s*month,?\s*year)") &&
            Has(@"(?:noi cap|place of issue|cuc truong|director|dac diem nhan dang|personal identification|idvnm[0-9<])");
        var electricity = Has(@"(?<![a-z/])k\s*w\s*h(?![a-z/])");
        var water = Has(@"(?<![a-z/])(?:m\s*(?:\^\s*)?[3³]|㎥)(?![a-z/])");
        var candidates = new List<OcrDocumentKind>();
        if (front) candidates.Add(OcrDocumentKind.IdentityFront);
        if (back) candidates.Add(OcrDocumentKind.IdentityBack);
        // A unit can narrow utility; it cannot establish mechanical vs digital.
        if (electricity) candidates.AddRange([OcrDocumentKind.MechanicalElectricity, OcrDocumentKind.DigitalElectricity]);
        if (water) candidates.AddRange([OcrDocumentKind.MechanicalWater, OcrDocumentKind.DigitalWater]);
        return candidates.Count switch
        {
            1 => new("classified", candidates[0], "text_rules", Warnings: ["classification_text_evidence"]),
            > 1 => new("ambiguous", null, "text_rules", Candidates: candidates, Warnings: ["classification_requires_review"]),
            _ => new("unknown", null, "text_rules", Warnings: ["classification_insufficient_evidence"])
        };
    }
}

public static class AutomaticOcrRouter
{
    public static AutomaticOcrResult Route(OcrImageAnalysis analysis, float minimumVisualConfidence)
    {
        var rules = OcrCategoryRules.Evaluate(analysis.Text);
        var decision = analysis.VisualDecision ?? rules;
        if (analysis.VisualDecision is { } visual)
        {
            if (visual.Status != "classified" || visual.Candidates is { Count: > 1 } ||
                (visual.Warnings ?? []).Any(w => w is "multiple_meters" or "ambiguous_reading" or "multiple_reading_regions") ||
                visual.Kind is null || !Enum.IsDefined(visual.Kind.Value) ||
                visual.Confidence is not { } confidence || !float.IsFinite(confidence) ||
                confidence < minimumVisualConfidence || confidence > 1)
                decision = visual with { Status = visual.Status is "unknown" or "unavailable" ? visual.Status : "ambiguous", Kind = null };
            else if (rules.Candidates is { Count: > 0 } candidates && !candidates.Contains(visual.Kind.Value) ||
                rules.Kind is { } ruleKind && ruleKind != visual.Kind.Value)
                decision = new("ambiguous", null, "visual_model", Candidates: [visual.Kind.Value, .. rules.Candidates ?? [], .. rules.Kind is { } k ? new[] { k } : []],
                    Warnings: ["classification_conflict"]);
        }
        var warnings = analysis.Text.Warnings.Concat(decision.Warnings ?? []).Distinct().ToArray();
        if (decision.Status != "classified" || decision.Kind is null)
            return new(decision.Status, "unknown", null, decision.Source,
                (decision.Candidates ?? []).Where(Enum.IsDefined).Select(OcrCategories.Name).Distinct().ToArray(), warnings);
        var kind = decision.Kind.Value;
        var proposal = OcrFieldParser.Parse(analysis.Text, kind);
        if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
        {
            proposal = MeterReadingPrecision.Apply(proposal, null);
            proposal = proposal with { Warnings = [.. proposal.Warnings, "reading_region_unverified",
                .. kind is OcrDocumentKind.DigitalElectricity or OcrDocumentKind.DigitalWater ? new[] { "billing_register_unverified" } : []] };
        }
        return new("classified", OcrCategories.Name(kind), decision.Confidence, decision.Source, [], warnings,
            kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack ? proposal : null,
            kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack) ? proposal : null);
    }

    public static AutomaticOcrResult Unavailable(string warning) => new("unavailable", "unknown", null, "none", [], [warning]);
}
