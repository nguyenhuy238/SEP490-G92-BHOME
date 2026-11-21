using OpenCvSharp;
using BHome.Application.Ocr;

namespace BHome.Infrastructure.Ocr;

internal static class OcrImageGeometry
{
    public static RotatedRect Expand(RotatedRect box)
    {
        // Rectangular DB unclip: 2 * area * ratio / perimeter. A fixed half-height expansion
        // cuts strokes/diacritics from the detector's shrunken text polygons.
        var padding = box.Size.Width * box.Size.Height * 1.5f / (box.Size.Width + box.Size.Height);
        return new(box.Center, new Size2f(box.Size.Width + padding, box.Size.Height + padding), box.Angle);
    }

    public static bool IsVertical(IReadOnlyList<RotatedRect> regions)
    {
        double horizontal = 0, vertical = 0;
        foreach (var region in regions)
        {
            var bounds = region.BoundingRect();
            if (bounds.Height > bounds.Width * 2) vertical += region.Size.Width * region.Size.Height;
            if (bounds.Width > bounds.Height * 2) horizontal += region.Size.Width * region.Size.Height;
        }
        return vertical > 0 && vertical > horizontal * 1.5;
    }

    public static double PageAngle(IReadOnlyList<RotatedRect> regions)
    {
        var angles = new List<double>();
        foreach (var region in regions)
        {
            var corners = Corners(region);
            var dx = corners[1].X - corners[0].X;
            var dy = corners[1].Y - corners[0].Y;
            if (Math.Max(region.Size.Width, region.Size.Height) < Math.Min(region.Size.Width, region.Size.Height) * 2) continue;
            var angle = Math.Atan2(dy, dx);
            if (Math.Abs(angle) <= Math.PI * 35 / 180) angles.Add(angle);
        }
        angles.Sort();
        return angles.Count == 0 ? 0 : angles[angles.Count / 2];
    }

    public static OcrBounds LayoutBounds(RotatedRect region, double pageAngle)
    {
        var width = Math.Max(region.Size.Width, region.Size.Height);
        var height = Math.Min(region.Size.Width, region.Size.Height);
        var x = region.Center.X * Math.Cos(pageAngle) + region.Center.Y * Math.Sin(pageAngle);
        var y = -region.Center.X * Math.Sin(pageAngle) + region.Center.Y * Math.Cos(pageAngle);
        return new((float)x - width / 2, (float)y - height / 2, width, height);
    }

    public static Point2f[] Corners(RotatedRect region)
    {
        // Sort left/right pairs first. Sorting by Y groups the two LEFT corners of long
        // sloping lines, turning an ordinary 8-degree camera tilt into a 90-degree text crop.
        var points = region.Points().OrderBy(point => point.X).ToArray();
        var left = points.Take(2).OrderBy(point => point.Y).ToArray();
        var right = points.Skip(2).OrderBy(point => point.Y).ToArray();
        return [left[0], right[0], right[1], left[1]];
    }
}
