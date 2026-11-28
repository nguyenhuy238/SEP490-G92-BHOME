using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class IdentityFieldRegions
{
    public static IEnumerable<(string Field, Rect Region)> MissingOrUncertain(OcrProposal proposal, Size size, OcrDocumentKind kind)
    {
        if (size.Width / (double)size.Height is < 1.35 or > 1.9) yield break;
        (string Field, double X, double Y, double Width, double Height)[] regions = kind == OcrDocumentKind.IdentityFront
            ? [("fullName", .27, .46, .71, .17), ("residentialAddress", .27, .82, .72, .18),
                ("placeOfOrigin", .27, .73, .72, .14), ("dateOfBirth", .27, .58, .72, .12),
                ("citizenIdentityNumber", .27, .39, .71, .14), ("gender", .27, .65, .72, .12),
                ("nationality", .27, .65, .72, .12), ("dateOfExpiry", 0, .82, .33, .18)]
            : [("dateOfIssue", 0, .08, .65, .19)];
        // Missing fields first. Geometry only selects pixels: the normal parser
        // must still observe the corresponding printed label and its value.
        foreach (var region in regions.OrderBy(region => proposal.ProposedFields.ContainsKey(region.Field) ? 1 : 0))
        {
            var threshold = region.Field == "fullName" ? .98f : .9f;
            if (proposal.ProposedFields.ContainsKey(region.Field) && proposal.Confidence.GetValueOrDefault(region.Field) >= threshold ||
                proposal.Warnings.Contains("conflicting_" + region.Field)) continue;
            var x = (int)(region.X * size.Width); var y = (int)(region.Y * size.Height);
            yield return (region.Field, new Rect(x, y, Math.Min(size.Width - x, (int)Math.Ceiling(region.Width * size.Width)),
                Math.Min(size.Height - y, (int)Math.Ceiling(region.Height * size.Height))));
        }
    }

    public static bool Complete(OcrDocumentKind kind, Size size, IReadOnlyList<RotatedRect> regions, IReadOnlyList<OcrLine> lines)
    {
        if (lines.Count < 2) return false;
        var proposal = OcrFieldParser.Parse(new(lines, "internal", []), kind);
        if (kind == OcrDocumentKind.IdentityFront)
        {
            var angle = OcrImageGeometry.PageAngle(regions);
            return size.Width / (double)size.Height is >= 1.35 and <= 1.9 &&
                IdentityOcrEvidence.FrontFields.All(field => proposal.ProposedFields.ContainsKey(field) && proposal.Confidence.GetValueOrDefault(field) >= .9f) &&
                // A first address line already counts as a value. Do not stop
                // while detected lower data rows may still contain its suffix.
                regions.Where(region => region.Center.Y > size.Height * .72 && region.Center.Y < size.Height * .98)
                    .All(region => lines.Any(line => line.Bounds == OcrImageGeometry.LayoutBounds(region, angle)));
        }
        // Only the photographed legacy chip layout: printed bilingual issue-date
        // label near the top plus three MRZ-shaped rows at the bottom. Other back
        // layouts retain the complete-page path and all their supported fields.
        return kind == OcrDocumentKind.IdentityBack && proposal.ProposedFields.ContainsKey("dateOfIssue") &&
            MrzRows(regions, lines, size).Count >= 2;
    }

    public static List<RotatedRect> MrzRows(IReadOnlyList<RotatedRect> regions, IReadOnlyList<OcrLine> lines, Size size)
    {
        var label = lines.FirstOrDefault(line => line.Bounds is not null && line.Text.Contains("month", StringComparison.OrdinalIgnoreCase));
        if (label?.Bounds is not { } anchor) return [];
        return regions.Where(region => region.Center.Y > anchor.Y + anchor.Height * 2 &&
            Math.Max(region.Size.Width, region.Size.Height) > size.Width * .5 &&
            Math.Max(region.Size.Width, region.Size.Height) / Math.Min(region.Size.Width, region.Size.Height) > 10)
            .OrderBy(region => region.Center.Y).Take(3).ToList();
    }
}
