using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

internal static class IdentityOcrLayout
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);

    public static OcrLine[] SplitRows(IEnumerable<OcrLine> input, IReadOnlyList<(string Key, string Pattern)> labels)
    {
        var result = new List<OcrLine>();
        foreach (var line in input)
        {
            var folded = OcrFieldParser.FoldLabels(line.Text);
            var matches = labels.SelectMany(label => Regex.Matches(folded, $@"(?<!\p{{L}})(?:{label.Pattern})(?=$|[:/\s])",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout).Cast<Match>()
                .Select(match => (label.Key, match.Index))).OrderBy(match => match.Index).ToArray();
            var starts = new List<int> { 0 };
            for (var index = 1; index < matches.Length; index++)
                if (matches[index].Key != matches[index - 1].Key) starts.Add(matches[index].Index);
            for (var index = 0; index < starts.Count; index++)
            {
                var end = index + 1 < starts.Count ? starts[index + 1] : line.Text.Length;
                result.Add(line with { Text = line.Text[starts[index]..end].Trim(' ', '/', ':', '-') });
            }
        }
        return result.ToArray();
    }

    public static IEnumerable<int> Following(OcrLine[] lines, int index, Func<string, bool> differentLabel)
    {
        if (lines[index].Bounds is not { } anchor)
            return Enumerable.Range(index + 1, Math.Min(3, lines.Length - index - 1));
        return Enumerable.Range(0, lines.Length).Where(next => next != index && lines[next].Bounds is { } value &&
            NearAfter(anchor, value) && !lines.Any(line => line.Bounds is { } barrier &&
                barrier.Y > anchor.Y + anchor.Height * .5f && barrier.Y < value.Y && SameColumn(anchor, barrier) && differentLabel(line.Text)))
            .OrderBy(next => Distance(anchor, lines[next].Bounds!));
    }

    public static bool NearAfter(OcrBounds anchor, OcrBounds value)
    {
        var height = Math.Max(anchor.Height, value.Height);
        var sameRow = Math.Abs(anchor.Y + anchor.Height / 2 - value.Y - value.Height / 2) <= height * .5f;
        if (sameRow) return value.X >= anchor.X + anchor.Width - height * .2f && value.X - anchor.X - anchor.Width <= height * 4;
        return value.Y >= anchor.Y + anchor.Height * .7f && value.Y - anchor.Y - anchor.Height <= height * 3 && SameColumn(anchor, value);
    }

    public static bool Continuation(OcrLine previous, OcrLine next)
    {
        if (previous.Bounds is not { } a || next.Bounds is not { } b || !NearAfter(a, b) ||
            b.Y - a.Y - a.Height > Math.Max(a.Height, b.Height) * 1.5f) return false;
        return next.Text.Any(char.IsLetter) && !IsBoilerplate(next.Text);
    }

    public static bool IsBoilerplate(string value)
    {
        var text = OcrFieldParser.FoldLabels(value);
        return text.Contains('<') || Regex.IsMatch(text,
            @"^(?:Dac diem nhan dang|Personal identification|Van tay|Finger|Giam doc|Director|Bo Cong an|Ministry)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
    }

    private static bool SameColumn(OcrBounds a, OcrBounds b) => Math.Abs(a.X - b.X) <= Math.Max(a.Height, b.Height) * 1.5f ||
        Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X) >= Math.Min(a.Width, b.Width) * .5f;

    private static float Distance(OcrBounds a, OcrBounds b) => Math.Abs(b.Y - a.Y) * 4 + Math.Abs(b.X - a.X - a.Width);
}
