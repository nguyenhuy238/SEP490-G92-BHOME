using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class IdentityTextRegionOrder
{
    public static List<RotatedRect> Prioritize(List<RotatedRect> regions, Size image, OcrDocumentKind? kind)
    {
        var ratio = image.Width / (double)image.Height;
        if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack) || ratio is < 1.35 or > 1.9)
            return regions;
        var ordered = new List<RotatedRect>();
        var seen = new HashSet<RotatedRect>();
        // Large printed values are useful first, together with the nearest label
        // above them. No field values or card identity are inferred from geometry.
        // On chip cards the large MRZ/signatory text and the national heading can
        // otherwise exhaust the deadline before any labelled personal fields.
        // This is only a scheduling hint: still read every region when time allows,
        // and let the label-based parser decide what each observed value means.
        foreach (var value in regions.OrderBy(r => PriorityBand(r, image, kind))
            .ThenByDescending(r => Math.Min(r.Size.Width, r.Size.Height)))
        {
            var bounds = value.BoundingRect();
            var label = regions.Where(r => r != value).Select(r => (Region: r, Bounds: r.BoundingRect()))
                .Where(r => r.Bounds.Bottom <= bounds.Y + bounds.Height * .3 &&
                    bounds.Y - r.Bounds.Bottom <= bounds.Height * 2 &&
                    Math.Min(r.Bounds.Right, bounds.Right) - Math.Max(r.Bounds.X, bounds.X) > Math.Min(r.Bounds.Width, bounds.Width) * .25)
                .OrderBy(r => bounds.Y - r.Bounds.Bottom).FirstOrDefault();
            // Read the upper number-sized value before its small label. The
            // parser can recognize an observed 12-digit number without a label;
            // name/date labels still travel with their values below this band.
            var deferLabel = kind == OcrDocumentKind.IdentityFront && value.Center.Y < image.Height * .36;
            if (!deferLabel && label.Bounds.Width > 0 && PriorityBand(label.Region, image, kind) == PriorityBand(value, image, kind) &&
                seen.Add(label.Region)) ordered.Add(label.Region);
            if (seen.Add(value)) ordered.Add(value);
        }
        return ordered;
    }

    private static int PriorityBand(RotatedRect region, Size image, OcrDocumentKind? kind) => kind switch
    {
        OcrDocumentKind.IdentityFront => region.Center.X >= image.Width * .25 &&
            region.Center.Y >= image.Height * .25 && region.Center.Y <= image.Height * .72 &&
            (region.Center.Y >= image.Height * .38 || Math.Max(region.Size.Width, region.Size.Height) <= image.Width * .48) ? 0 :
            region.Center.Y > image.Height * .72 && region.Center.Y <= image.Height * .98 ? 1 : 2,
        OcrDocumentKind.IdentityBack => region.Center.X <= image.Width * .8 &&
            region.Center.Y >= image.Height * .03 && region.Center.Y <= image.Height * .55 ? 0 : 2,
        _ => 2
    };
}
