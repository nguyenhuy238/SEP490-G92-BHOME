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
        foreach (var value in regions.OrderByDescending(r => Math.Min(r.Size.Width, r.Size.Height)))
        {
            var bounds = value.BoundingRect();
            var label = regions.Where(r => r != value).Select(r => (Region: r, Bounds: r.BoundingRect()))
                .Where(r => r.Bounds.Bottom <= bounds.Y + bounds.Height * .3 &&
                    bounds.Y - r.Bounds.Bottom <= bounds.Height * 2 &&
                    Math.Min(r.Bounds.Right, bounds.Right) - Math.Max(r.Bounds.X, bounds.X) > Math.Min(r.Bounds.Width, bounds.Width) * .25)
                .OrderBy(r => bounds.Y - r.Bounds.Bottom).FirstOrDefault();
            if (label.Bounds.Width > 0 && seen.Add(label.Region)) ordered.Add(label.Region);
            if (seen.Add(value)) ordered.Add(value);
        }
        return ordered;
    }
}
