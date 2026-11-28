namespace BHome.Application.Ocr;

// DecimalPlaces is the actual display precision configured for a Meter, not a billing rounding rule.
public static class MeterReadingPrecision
{
    public static OcrProposal Apply(OcrProposal proposal, int? decimalPlaces)
    {
        if (decimalPlaces is < 0 or > 4) throw new OcrInputException("invalid_meter_precision");
        if (!proposal.ProposedFields.TryGetValue("reading", out var reading)) return proposal;
        var separator = reading.IndexOf('.');
        if (decimalPlaces is null)
            return separator >= 0 ? proposal : proposal with { Warnings = [.. proposal.Warnings, "decimal_separator_unverified"] };
        if (separator >= 0 && reading.Length - separator - 1 == decimalPlaces) return proposal;
        if (separator < 0 && decimalPlaces == 0) return proposal;
        if (separator < 0 && reading.Length > decimalPlaces)
        {
            var fields = proposal.ProposedFields.ToDictionary(field => field.Key, field => field.Value);
            fields["reading"] = reading.Insert(reading.Length - decimalPlaces.Value, ".");
            return proposal with { ProposedFields = fields, Warnings = [.. proposal.Warnings, "decimal_places_applied"] };
        }
        var remaining = proposal.ProposedFields.Where(field => field.Key != "reading").ToDictionary(field => field.Key, field => field.Value);
        return proposal with
        {
            ProposedFields = remaining,
            Confidence = proposal.Confidence.Where(field => field.Key != "reading").ToDictionary(field => field.Key, field => field.Value),
            MissingFields = [.. proposal.MissingFields.Where(field => field != "reading"), "reading"],
            Warnings = [.. proposal.Warnings, "meter_precision_mismatch"],
            IsFallback = remaining.Count == 0
        };
    }
}
