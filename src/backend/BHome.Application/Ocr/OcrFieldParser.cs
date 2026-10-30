using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

// Conservative label-based extraction: never infer nationality, gender, dates or a meter multiplier.
public static class OcrFieldParser
{
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(100);
    private static MatchCollection Matches(string text, string pattern) => Regex.Matches(text, pattern,
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase, RegexTimeout);

    public static OcrProposal Parse(OcrText text, OcrDocumentKind kind)
    {
        var fields = new Dictionary<string, string>();
        var confidence = new Dictionary<string, float>();
        var warnings = text.Warnings.ToList();
        if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
        {
            var reading = warnings.Contains("conflicting_reading") ? null : MeterReadingParser.Parse(text.Lines, kind, warnings);
            if (reading is not null)
            {
                fields["reading"] = reading.Value.Value;
                confidence["reading"] = reading.Value.Confidence;
            }
        }
        else
        {
            var lines = IdentityOcrLayout.SplitRows(text.Lines.Select(x => x with { Text = x.Text.Normalize(NormalizationForm.FormC).Trim() }), Labels);
            var identities = lines.SelectMany(x => Matches(x.Text, @"(?<!\d)[0-9]{12}(?!\d)").Cast<Match>()
                .Select(m => (m.Value, x.Confidence))).ToArray();
            if (identities.Select(x => x.Value).Distinct().Count() == 1)
            {
                fields["citizenIdentityNumber"] = identities[0].Value;
                confidence["citizenIdentityNumber"] = identities.Min(x => x.Confidence);
            }
            else if (identities.Length > 1) warnings.Add("conflicting_identity_numbers");

            foreach (var (key, label) in Labels)
            {
                for (var i = 0; i < lines.Length; i++)
                {
                    if (!MatchLabel(lines[i].Text, label).Success) continue;
                    var candidate = StripLabel(lines[i].Text, label);
                    var score = lines[i].Confidence;
                    var valueIndex = i;
                    // A detector may split Vietnamese label, English translation and value into separate regions.
                    foreach (var next in candidate.Length == 0
                        ? IdentityOcrLayout.Following(lines, i, value => IsLabel(value) && !MatchLabel(value, label).Success)
                        : Enumerable.Empty<int>())
                    {
                        if (candidate.Length > 0) break;
                        var following = lines[next].Text;
                        if (IsLabel(following) && !MatchLabel(following, label).Success)
                        { if (lines[i].Bounds is null) break; else continue; }
                        candidate = StripLabel(following, label);
                        score = Math.Min(score, lines[next].Confidence);
                        valueIndex = next;
                    }
                    if (candidate.Length == 0) continue;
                    if (key is "residentialAddress" or "placeOfOrigin" or "placeOfIssue")
                    {
                        var used = new HashSet<int> { i, valueIndex };
                        for (var continuation = 0; continuation < 2; continuation++)
                        {
                            var next = IdentityOcrLayout.Following(lines, valueIndex, IsLabel).FirstOrDefault(next => !used.Contains(next), -1);
                            if (next < 0 || IsLabel(lines[next].Text) || !IdentityOcrLayout.Continuation(lines[valueIndex], lines[next])) break;
                            candidate += " " + lines[next].Text;
                            score = Math.Min(score, lines[next].Confidence);
                            used.Add(next); valueIndex = next;
                        }
                    }
                    if (key is "dateOfBirth" or "dateOfIssue" or "dateOfExpiry")
                    {
                        const string datePattern = @"(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-]\d{4}(?!\d)";
                        var dates = Matches(candidate, datePattern);
                        // A partially recognized English translation must not hide a clear date
                        // on the next row. Do not cross another field label or use an unlabelled date.
                        for (var next = i + 1; dates.Count == 0 && next < lines.Length && next <= i + 3; next++)
                        {
                            if (IsLabel(lines[next].Text) && !MatchLabel(lines[next].Text, label).Success) break;
                            if (lines[i].Bounds is { } a && lines[next].Bounds is { } b && !IdentityOcrLayout.NearAfter(a, b)) continue;
                            var following = StripLabel(lines[next].Text, label);
                            if (!Regex.IsMatch(following, $@"^{datePattern}$", RegexOptions.CultureInvariant, RegexTimeout)) continue;
                            dates = Matches(following, datePattern);
                            score = Math.Min(score, lines[next].Confidence);
                        }
                        if (dates.Count != 1 || !DateOnly.TryParseExact(dates[0].Value,
                            ["d/M/yyyy", "d-M-yyyy", "d.M.yyyy"], CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var date)) { warnings.Add($"invalid_{key}"); continue; }
                        candidate = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    }
                    if ((key == "fullName" && !candidate.Any(char.IsLetter)) ||
                        (key is "fullName" or "residentialAddress" or "placeOfOrigin" && IdentityOcrLayout.IsBoilerplate(candidate)))
                    { warnings.Add($"invalid_{key}"); continue; }
                    if (fields.TryGetValue(key, out var previous) && previous != candidate)
                    { fields.Remove(key); confidence.Remove(key); warnings.Add($"conflicting_{key}"); break; }
                    fields[key] = candidate;
                    confidence[key] = score;
                }
            }
            if (fields.Count == 0) warnings.Add("unsupported_or_unreadable_layout");
        }
        if (confidence.Values.Any(x => x < .8f)) warnings.Add("low_confidence");
        var required = kind switch
        {
            OcrDocumentKind.IdentityFront => new[] { "citizenIdentityNumber", "fullName", "dateOfBirth" },
            OcrDocumentKind.IdentityBack => [], // back layouts vary; no invented required field
            _ => ["reading"]
        };
        return new(fields, text.EngineVersion)
        {
            Confidence = confidence,
            Warnings = warnings.Distinct().ToArray(),
            MissingFields = required.Where(x => !fields.ContainsKey(x)).ToArray(),
            IsFallback = fields.Count == 0
        };
    }

    private static bool IsLabel(string line) => Labels.Any(x => MatchLabel(line, x.Pattern).Success);

    private static Match MatchLabel(string line, string pattern) => Regex.Match(FoldLabels(line).Trim(' ', ':', '/', '-'),
        $"^(?:{pattern})(?=$|[:/\\s])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, RegexTimeout);

    internal static string FoldLabels(string text) => string.Concat(text.Normalize(NormalizationForm.FormD)
        .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark))
        .Replace('đ', 'd').Replace('Đ', 'D').Normalize(NormalizationForm.FormC);

    private static string StripLabel(string text, string pattern)
    {
        var value = text.Trim(' ', ':', '/', '-');
        while (true)
        {
            var match = MatchLabel(value, pattern);
            if (!match.Success) return value;
            value = value[match.Length..].Trim(' ', ':', '/', '-');
        }
    }

    private static readonly (string Key, string Pattern)[] Labels =
    [
        ("fullName", @"(?:Ho va ten|Ho,? chu dem va ten|Full name)\s*:?"),
        ("dateOfBirth", @"(?:Ngay sinh|Date of birth)\s*:?"),
        ("gender", @"(?:Gioi tinh|Sex)\s*:?"),
        ("nationality", @"(?:Quoc tich|Nationality)\s*:?"),
        ("placeOfOrigin", @"(?:Que quan|Place of origin)\s*:?"),
        ("residentialAddress", @"(?:Noi thuong tru|Noi cu tru|Place of residence)\s*:?"),
        ("dateOfIssue", @"(?:Ngay cap|Date of issue|Ngay\s*,?\s*thang\s*,?\s*nam|Date\s*,?\s*month\s*,?\s*year)\s*:?"),
        ("placeOfIssue", @"(?:Noi cap|Place of issue)\s*:?"),
        ("dateOfExpiry", @"(?:Co gia tri den|Date of expiry)\s*:?")
    ];
}
