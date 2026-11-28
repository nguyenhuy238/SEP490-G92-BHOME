using System.Text.RegularExpressions;
using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class OcrNumericRefinement
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);

    public static Mat Binarize(Mat crop)
    {
        using var gray = new Mat();
        using var mask = new Mat();
        Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.Threshold(gray, mask, 0, 255, ThresholdTypes.Binary | ThresholdTypes.Otsu);
        if (Cv2.CountNonZero(mask) < mask.Width * mask.Height / 2) Cv2.BitwiseNot(mask, mask);
        var output = new Mat();
        Cv2.CvtColor(mask, output, ColorConversionCodes.GRAY2BGR);
        return output;
    }

    public static bool HasUnit(OcrLine line, IReadOnlyList<OcrLine> lines, OcrDocumentKind kind)
    {
        if (Regex.IsMatch(line.Text, $@"(?:/\s*{MeterOcrLayout.UnitPattern}|{MeterOcrLayout.UnitPattern}\s*/|\b(?:S/N|SN|No\.|Hz|imp|xung|rev)\b)",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout)) return false;
        var unit = Regex.Match(line.Text, $@"{MeterOcrLayout.UnitPattern}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
        var prefix = Regex.Match(line.Text, $@"^{MeterOcrLayout.UnitPattern}", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
        if ((unit.Success && MeterOcrLayout.IsCorrectUnit(unit.Value, kind)) ||
            (prefix.Success && MeterOcrLayout.IsCorrectUnit(prefix.Value, kind))) return true;
        if (line.Bounds is not { } a) return false;
        return lines.Any(other => other.Bounds is { } b &&
            MeterOcrLayout.IsCorrectUnit(other.Text, kind) && MeterOcrLayout.Nearby(a, b));
    }

    public static (OcrLine Line, bool Changed, bool Conflicting) Select(OcrLine original, OcrLine candidate, OcrDocumentKind kind)
    {
        var originalValue = Value(original, kind);
        var candidateValue = Value(candidate, kind);
        if (candidateValue is null) return (original, false, false);
        var suffix = Regex.Match(original.Text, $@"{MeterOcrLayout.UnitPattern}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
        if (suffix.Success && !Regex.IsMatch(candidate.Text, $@"{MeterOcrLayout.UnitPattern}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout))
            candidate = candidate with { Text = $"{candidate.Text} {suffix.Value}" };
        if (originalValue is not null && originalValue != candidateValue)
        {
            if (originalValue.Replace(".", "") == candidateValue.Replace(".", "") &&
                originalValue.Contains('.') != candidateValue.Contains('.'))
                return originalValue.Contains('.') ? (original, false, false) : (candidate with { Bounds = original.Bounds }, true, false);
            return (original with { Text = "" }, false, true);
        }
        if (originalValue is not null) return (original with { Confidence = Math.Min(original.Confidence, candidate.Confidence) }, false, false);
        return (candidate with { Bounds = original.Bounds }, true, false);
    }

    public static bool HasReading(OcrLine line, OcrDocumentKind kind) => Value(line, kind) is not null;

    private static string? Value(OcrLine line, OcrDocumentKind kind) =>
        OcrFieldParser.Parse(new([line], "internal", []), kind).ProposedFields.GetValueOrDefault("reading");
}
