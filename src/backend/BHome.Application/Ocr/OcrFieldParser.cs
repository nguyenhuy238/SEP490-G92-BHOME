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
            // Several displays, meter serial numbers or units => require manual selection/crop.
            var candidates = text.Lines.SelectMany(line => Matches(line.Text,
                @"(?<![\p{L}\d.,+\-])\d+(?:[.,]\d+)?(?![\p{L}\d.,])").Cast<Match>()
                .Select(m => (Value: m.Value.Replace(',', '.'), line.Confidence))).ToArray();
            var unique = candidates.Select(x => x.Value).Distinct().ToArray();
            if (unique.Length == 1 && decimal.TryParse(unique[0], NumberStyles.AllowDecimalPoint,
                    CultureInfo.InvariantCulture, out var value) && value >= 0)
            {
                fields["reading"] = unique[0]; // preserve leading zeroes and observed precision
                confidence["reading"] = candidates.Min(x => x.Confidence);
            }
            else warnings.Add(unique.Length > 1 ? "ambiguous_reading" : "reading_not_recognized");
        }
        else
        {
            var lines = text.Lines.Select(x => new OcrLine(x.Text.Normalize(NormalizationForm.FormC).Trim(), x.Confidence)).ToArray();
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
                    var match = Regex.Match(lines[i].Text, label, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, RegexTimeout);
                    if (!match.Success) continue;
                    var candidate = lines[i].Text[(match.Index + match.Length)..].Trim(' ', ':', '/', '-');
                    var score = lines[i].Confidence;
                    if (candidate.Length == 0 && i + 1 < lines.Length && !IsLabel(lines[i + 1].Text))
                    { candidate = lines[i + 1].Text; score = Math.Min(score, lines[i + 1].Confidence); }
                    if (candidate.Length == 0) continue;
                    if (key is "dateOfBirth" or "dateOfIssue" or "dateOfExpiry")
                    {
                        var dates = Matches(candidate, @"(?<!\d)\d{2}[/.-]\d{2}[/.-]\d{4}(?!\d)");
                        if (dates.Count != 1 || !DateOnly.TryParseExact(dates[0].Value,
                            ["dd/MM/yyyy", "dd-MM-yyyy", "dd.MM.yyyy"], CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var date)) { warnings.Add($"invalid_{key}"); continue; }
                        candidate = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    }
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

    private static bool IsLabel(string line) => Labels.Any(x => Regex.IsMatch(line, x.Pattern,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, RegexTimeout));

    private static readonly (string Key, string Pattern)[] Labels =
    [
        ("fullName", @"(?:Họ và tên|Họ,? chữ đệm và tên|Full name)\s*(?:/\s*Full name)?\s*:?"),
        ("dateOfBirth", @"(?:Ngày sinh|Date of birth)\s*(?:/\s*Date of birth)?\s*:?"),
        ("gender", @"(?:Giới tính|Sex)\s*(?:/\s*Sex)?\s*:?"),
        ("nationality", @"(?:Quốc tịch|Nationality)\s*(?:/\s*Nationality)?\s*:?"),
        ("placeOfOrigin", @"(?:Quê quán|Place of origin)\s*(?:/\s*Place of origin)?\s*:?"),
        ("residentialAddress", @"(?:Nơi thường trú|Nơi cư trú|Place of residence)\s*(?:/\s*Place of residence)?\s*:?"),
        ("dateOfIssue", @"(?:Ngày cấp|Date of issue)\s*(?:/\s*Date of issue)?\s*:?"),
        ("dateOfExpiry", @"(?:Có giá trị đến|Date of expiry)\s*(?:/\s*Date of expiry)?\s*:?")
    ];
}
