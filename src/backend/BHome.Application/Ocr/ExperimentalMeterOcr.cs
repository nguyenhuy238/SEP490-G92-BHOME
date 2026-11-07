using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

// Diagnostic observations cannot be used as an OcrProposal or persisted reading.
public sealed record ExperimentalMeterOcrResult(string Status, OcrCategoryDecision Classification,
    string? CandidateCategory, string? ReadingCandidate, string DisplayState, string RegisterStatus,
    IReadOnlyList<string> Warnings, OcrBounds? ReadingBounds = null)
{
    public bool Experimental => true;
    public bool BusinessProposalEnabled => false;
    public bool RequiresConfirmation => true;
    public override string ToString() => "Experimental OCR diagnostic (image and reading omitted)";
    public static ExperimentalMeterOcrResult Unavailable(string warning) => new("unavailable",
        new("unavailable", null, "experimental_supervised_clip"), null, null, "unknown", "unverified", [warning]);
}

public interface IExperimentalMeterOcrService
{
    Task<ExperimentalMeterOcrResult> ExtractExperimentalMeterAsync(Stream input, CancellationToken token);
}

public interface IExperimentalMeterAnalysisEngine
{
    Task<ExperimentalMeterOcrResult> AnalyzeExperimentalMeterAsync(ReadOnlyMemory<byte> image, CancellationToken token);
}

public sealed record ExperimentalRegisterDecision(OcrLine? Candidate, string Status, IReadOnlyList<string> Warnings);

// Research gate only. Business proposals continue through the existing workflow.
public static class ExperimentalRegisterSelection
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    private static bool Match(string text, string pattern) => Regex.IsMatch(text, pattern,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);

    public static ExperimentalRegisterDecision Select(OcrDocumentKind kind, IReadOnlyList<OcrLine> lines)
    {
        var evidence = lines.Where(l => l.Bounds is not null && float.IsFinite(l.Confidence) && l.Confidence is >= .5f and <= 1).ToArray();
        if (evidence.Any(l => Match(l.Text, @"\b(?:horaire|timer|hour[ -]?(?:meter|counter))\b")))
            return new(null, "non_consumption", ["non_consumption_device"]);
        var candidates = new List<OcrLine>();
        foreach (var line in evidence)
        {
            // A single digit is valid. Never strip text/status codes to make digits.
            if (!Match(line.Text, @"^[0-9]{1,12}(?:[.,][0-9]{1,4})?$")) continue;
            var bounds = line.Bounds!;
            bool SameRow(OcrLine other) => Math.Abs(bounds.Y + bounds.Height / 2 - other.Bounds!.Y - other.Bounds.Height / 2) <= Math.Max(bounds.Height, other.Bounds.Height) * .6 &&
                Math.Max(bounds.X - other.Bounds.X - other.Bounds.Width, other.Bounds.X - bounds.X - bounds.Width) <= Math.Max(bounds.Height, other.Bounds.Height) * 2;
            if (evidence.Any(other => other != line && SameRow(other) &&
                (MeterOcrLayout.IsNonBillingUnit(other.Text) || Match(other.Text, @"\b(?:serial|s\.?\s*no\.?|voltage|frequency|temperature|flow[ -]?rate)\b") ||
                 Match(other.Text.Trim(), @"^(?:L[123]|status|phase)$")))) continue;
            var unit = evidence.Any(label => label != line && MeterOcrLayout.Nearby(bounds, label.Bounds!) &&
                MeterOcrLayout.IsCorrectUnit(label.Text.Trim(), kind));
            if (unit) candidates.Add(line);
        }
        var distinct = candidates.Select(c => c.Text).Distinct(StringComparer.Ordinal).ToArray();
        if (distinct.Length > 1) return new(null, "ambiguous", ["multiple_consumption_candidates"]);
        if (distinct.Length == 0) return new(null, "unverified", ["consumption_unit_or_register_unverified"]);
        return new(candidates.First(c => c.Text == distinct[0]), "consumption_candidate",
            ["experimental_ocr", "decimal_precision_unverified", "register_requires_human_review"]);
    }
}
