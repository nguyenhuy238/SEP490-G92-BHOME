using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

public static class IdentityOcrEvidence
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    public static readonly string[] FrontFields = ["citizenIdentityNumber", "fullName", "dateOfBirth", "gender", "nationality", "placeOfOrigin", "residentialAddress", "dateOfExpiry"];

    // The supported legacy chip QR has exactly seven pipe-delimited fields.
    // Unsupported payloads/URLs are never followed or guessed into this schema.
    public static IReadOnlyList<IdentityFieldObservation> ParseQr(string payload)
    {
        if (payload.Length > 1500 || payload.Any(char.IsControl)) return [];
        var parts = payload.Normalize(NormalizationForm.FormC).Split('|').Select(value => value.Trim()).ToArray();
        if (parts.Length != 7 || !Regex.IsMatch(parts[0], @"^[0-9]{12}$", RegexOptions.None, Timeout) ||
            !Regex.IsMatch(parts[1], @"^(?:[0-9]{9}|[0-9]{12})?$", RegexOptions.None, Timeout) ||
            !Text(parts[2], 120) || !Text(parts[5], 600) || parts[4] is not ("Nam" or "Nữ") ||
            !DateOnly.TryParseExact(parts[3], "ddMMyyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var birth) ||
            !DateOnly.TryParseExact(parts[6], "ddMMyyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var issue) || issue < birth) return [];
        return [new("citizenIdentityNumber", parts[0], .95f, "qr"), new("fullName", parts[2], .95f, "qr"),
            new("dateOfBirth", birth.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), .95f, "qr"),
            new("gender", parts[4], .95f, "qr"), new("residentialAddress", parts[5], .95f, "qr"),
            new("dateOfIssue", issue.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), .95f, "qr")];
    }

    private static bool Text(string value, int maximum) => value.Length is > 1 && value.Length <= maximum &&
        value.Any(char.IsLetter) && value.All(c => char.IsLetterOrDigit(c) || " ,.-/'()".Contains(c));

    public static void Apply(Dictionary<string, string> fields, Dictionary<string, float> confidence,
        List<string> warnings, IEnumerable<IdentityFieldObservation> observations)
    {
        var batch = observations.ToArray();
        var rejectedSources = batch.Where(observation => observation.Field == "citizenIdentityNumber" &&
            observation.Source is "qr" or "mrz" && fields.TryGetValue(observation.Field, out var existing) &&
            !Equivalent(existing, observation.Value)).Select(observation => observation.Source).ToHashSet();
        if (rejectedSources.Count > 0)
        {
            warnings.Add("conflicting_citizenIdentityNumber");
            confidence["citizenIdentityNumber"] = .5f;
        }
        foreach (var observation in batch)
        {
            if (rejectedSources.Contains(observation.Source)) continue;
            if (!FrontFields.Contains(observation.Field) && observation.Field is not ("dateOfIssue" or "placeOfIssue") ||
                string.IsNullOrWhiteSpace(observation.Value) || !float.IsFinite(observation.Confidence) ||
                observation.Confidence is < 0 or > 1) continue;
            if (!fields.TryGetValue(observation.Field, out var original))
            {
                // Never recover a field already rejected for contradictory evidence.
                if (warnings.Contains("conflicting_" + observation.Field) ||
                    observation.Field == "citizenIdentityNumber" && warnings.Contains("conflicting_identity_numbers")) continue;
                fields[observation.Field] = observation.Value;
                confidence[observation.Field] = observation.Confidence;
                continue;
            }
            if (Equivalent(original, observation.Value) && !warnings.Contains("conflicting_" + observation.Field))
                confidence[observation.Field] = Math.Max(confidence.GetValueOrDefault(observation.Field), observation.Confidence);
            else if (Equivalent(original, observation.Value)) continue;
            else if (observation.Source == "region" && observation.Field is "residentialAddress" or "placeOfOrigin" &&
                observation.Confidence >= .9f && observation.Value.StartsWith(original + " ", StringComparison.Ordinal))
            {
                fields[observation.Field] = observation.Value;
                confidence[observation.Field] = observation.Confidence;
            }
            else
            {
                // Keep the first observed value for review; confidence never hides a conflict.
                confidence[observation.Field] = Math.Min(confidence.GetValueOrDefault(observation.Field), .5f);
                warnings.Add("conflicting_" + observation.Field);
            }
        }
    }

    public static bool Equivalent(string first, string second) =>
        string.Join(' ', first.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            .Equals(string.Join(' ', second.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)), StringComparison.OrdinalIgnoreCase);

    public static void CheckMrz(OcrLine[] lines, Dictionary<string, string> fields, Dictionary<string, float> confidence, List<string> warnings)
    {
        var rows = lines.Select(line => string.Concat(line.Text.Where(c => !char.IsWhiteSpace(c))).ToUpperInvariant())
            .Where(row => row.Length == 30 && row.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9' or '<')).ToArray();
        var first = rows.Where(row => row.StartsWith("IDVNM", StringComparison.Ordinal)).ToArray();
        if (first.Length == 0) return;
        var valid = new List<(string Upper, string Middle)>();
        foreach (var upper in first)
            foreach (var middle in rows.Where(row => row[7] is 'M' or 'F' or '<' && row.Substring(15, 3) == "VNM"))
                if (Check(upper.Substring(5, 9), upper[14]) && Check(middle[..6], middle[6]) &&
                    Check(middle.Substring(8, 6), middle[14]) &&
                    Check(upper[5..] + middle[..7] + middle.Substring(8, 7) + middle.Substring(18, 11), middle[29])) valid.Add((upper, middle));
        if (valid.Distinct().Count() != 1) { warnings.Add("mrz_unreadable"); return; }
        warnings.Add("mrz_checked");
        var upperRow = valid[0].Upper;
        var mrz = valid[0].Middle;
        var citizenId = upperRow.Substring(15, 12);
        var supportedIdentifier = citizenId.All(char.IsAsciiDigit) && upperRow.Substring(27, 2) == "<<" &&
            upperRow.Substring(5, 9) == citizenId[3..] && Check(citizenId, upperRow[29]);
        if (supportedIdentifier && fields.TryGetValue("citizenIdentityNumber", out var observedId) && observedId != citizenId)
        {
            warnings.Add("conflicting_citizenIdentityNumber");
            confidence["citizenIdentityNumber"] = .5f;
            return;
        }
        // YYMMDD cannot supply a century. It only corroborates an observed full date.
        foreach (var (key, value) in new[] { ("dateOfBirth", mrz[..6]), ("dateOfExpiry", mrz.Substring(8, 6)) })
            if (fields.TryGetValue(key, out var observed) && DateOnly.TryParseExact(observed, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) &&
                date.ToString("yyMMdd", CultureInfo.InvariantCulture) != value)
            { warnings.Add("conflicting_" + key); confidence[key] = .5f; }
        var gender = mrz[7] switch { 'M' => "Nam", 'F' => "Nữ", _ => null };
        if (gender is not null) Apply(fields, confidence, warnings, [new("gender", gender, .9f, "mrz")]);
        // Supported Vietnamese chip variant repeats the 12-digit identifier in
        // optional data, with its own check digit and the same trailing nine
        // digits as the document number. Other TD1 optional data is not guessed.
        if (!supportedIdentifier) return;
        var encodedGender = (citizenId[3] - '0') % 2 == 0 ? "Nam" : "Nữ";
        if (gender is null || encodedGender != gender || citizenId.Substring(4, 2) != mrz[..2])
        { warnings.Add("conflicting_gender"); if (confidence.ContainsKey("gender")) confidence["gender"] = .5f; return; }
        // Century is encoded in the repeated identifier, not chosen using age
        // or today's date. This never supplies a century for the expiry date.
        var year = 1900 + (citizenId[3] - '0') / 2 * 100 + int.Parse(mrz[..2], CultureInfo.InvariantCulture);
        if (!DateOnly.TryParseExact($"{year:D4}-{mrz.Substring(2, 2)}-{mrz.Substring(4, 2)}", "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var birth)) return;
        Apply(fields, confidence, warnings, [new("citizenIdentityNumber", citizenId, .9f, "mrz"),
            new("dateOfBirth", birth.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), .9f, "mrz"),
            new("nationality", "Việt Nam", .9f, "mrz")]);
        var names = rows.Where(row => row.EndsWith('<') && row.All(c => c is >= 'A' and <= 'Z' or '<') && row.Contains("<<", StringComparison.Ordinal))
            .Select(row => string.Join(' ', row.Split('<', StringSplitOptions.RemoveEmptyEntries))).Distinct().ToArray();
        if (names.Length == 1)
        {
            Apply(fields, confidence, warnings, [new("fullName", names[0], .65f, "mrz")]);
            warnings.Add("mrz_name_unaccented");
        }
    }

    private static bool Check(string data, char digit)
    {
        if (digit is < '0' or > '9') return false;
        var sum = 0;
        int[] weights = [7, 3, 1];
        for (var index = 0; index < data.Length; index++)
        {
            var value = data[index] switch { '<' => 0, >= '0' and <= '9' => data[index] - '0', >= 'A' and <= 'Z' => data[index] - 'A' + 10, _ => -1 };
            if (value < 0) return false;
            sum += value * weights[index % 3];
        }
        return sum % 10 == digit - '0';
    }
}
