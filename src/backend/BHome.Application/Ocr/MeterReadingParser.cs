using System.Globalization;
using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

// Select a displayed quantity by its reading label/unit, never by the largest number on the face.
internal static class MeterReadingParser
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    private const string Number = @"[0-9]+(?:[.,][0-9]+)?";
    private const string Unit = MeterOcrLayout.UnitPattern;
    private const string Label = @"(?:chi so(?:\s+(?:cong to|dien|nuoc))?|reading|index|total)\s*:?\s*";

    public static (string Value, float Confidence)? Parse(IReadOnlyList<OcrLine> lines,
        OcrDocumentKind kind, List<string> warnings)
    {
        lines = JoinDigitBoxes(lines);
        var candidates = new List<(string Value, float Confidence, bool Context)>();
        var unmatchedNumbers = false;
        foreach (var line in lines)
        {
            var text = OcrFieldParser.FoldLabels(line.Text).Trim();
            var match = Match(text, $@"^(?<label>{Label})?(?:(?<prefix>{Unit})\s*:?\s*)?(?<value>{Number})\s*(?<unit>{Unit})?$");
            if (!match.Success)
            {
                unmatchedNumbers |= text.Any(char.IsDigit);
                continue; // serials, voltage/current, dates, OBIS and malformed decimals
            }
            var unit = match.Groups["unit"].Value;
            var prefix = match.Groups["prefix"].Value;
            if ((unit.Length > 0 && !MeterOcrLayout.IsCorrectUnit(unit, kind)) ||
                (prefix.Length > 0 && !MeterOcrLayout.IsCorrectUnit(prefix, kind))) { unmatchedNumbers = true; continue; }
            var contextual = match.Groups["label"].Success || unit.Length > 0 || prefix.Length > 0;
            var score = line.Confidence;
            // Unit can be a separate text box; only associate it with the same nearby display row.
            if (!contextual && line.Bounds is { } bounds)
            {
                var units = lines.Where(other => other.Bounds is { } b && MeterOcrLayout.Nearby(bounds, b) &&
                    MeterOcrLayout.IsUnit(other.Text)).ToArray();
                if (units.Any(other => !MeterOcrLayout.IsCorrectUnit(other.Text, kind))) { unmatchedNumbers = true; continue; }
                if (units.Length > 0)
                {
                    contextual = true;
                    score = Math.Min(score, units.Min(other => other.Confidence));
                }
            }
            var value = match.Groups["value"].Value.Replace(',', '.');
            if (decimal.TryParse(value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _))
                candidates.Add((value, score, contextual));
        }

        var selected = candidates.Any(c => c.Context) ? candidates.Where(c => c.Context).ToArray() : candidates.ToArray();
        var unique = selected.Select(c => c.Value).Distinct().ToArray();
        if (!selected.Any(c => c.Context) && unmatchedNumbers)
        {
            warnings.Add("ambiguous_reading");
            return null;
        }
        if (unique.Length == 1) return (unique[0], selected.Min(c => c.Confidence));
        warnings.Add(unique.Length > 1 ? "ambiguous_reading" : "reading_not_recognized");
        return null;
    }

    private static IReadOnlyList<OcrLine> JoinDigitBoxes(IReadOnlyList<OcrLine> lines)
    {
        var remaining = lines.ToList();
        var fragments = lines.Where(line => line.Bounds is not null && Match(line.Text.Trim(), @"^(?:[0-9]+(?:[.,][0-9]*)?|[.,][0-9]*)$").Success)
            .OrderBy(line => line.Bounds!.X).ToArray();
        foreach (var first in fragments)
        {
            if (!remaining.Contains(first) || !char.IsDigit(first.Text.Trim()[0])) continue;
            var group = new List<OcrLine> { first };
            var previous = first.Bounds!;
            foreach (var next in fragments.Where(line => line.Bounds!.X > first.Bounds!.X && remaining.Contains(line)))
            {
                var b = next.Bounds!;
                var height = Math.Max(first.Bounds!.Height, b.Height);
                var gap = b.X - previous.X - previous.Width;
                if (Math.Abs(b.Y + b.Height / 2 - first.Bounds.Y - first.Bounds.Height / 2) > height * .5f) continue;
                if (gap < -height * .1f || gap > height * .6f) break;
                group.Add(next); previous = b;
            }
            // Require three adjacent boxes or an explicit isolated decimal separator between
            // chunks. Two unrelated numeric displays must never be concatenated.
            if (group.Count < 3 || (!group.Any(line => line.Text.Trim() is "." or ",") &&
                group.Any(line => line.Text.Trim().Length > 1))) continue;
            var value = string.Concat(group.Select(line => line.Text.Trim()));
            if (!Match(value, $@"^{Number}$").Success) continue;
            var left = group.Min(line => line.Bounds!.X); var top = group.Min(line => line.Bounds!.Y);
            var right = group.Max(line => line.Bounds!.X + line.Bounds.Width);
            var bottom = group.Max(line => line.Bounds!.Y + line.Bounds.Height);
            remaining.RemoveAll(group.Contains);
            remaining.Add(new(value, group.Min(line => line.Confidence)) { Bounds = new(left, top, right - left, bottom - top) });
        }
        return remaining;
    }

    private static Match Match(string text, string pattern) => Regex.Match(text, pattern,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
}
