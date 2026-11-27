using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Image geometry only: locating a card never verifies an identity or invents fields.
internal static class IdentityCardCropper
{
    public static bool TryCrop(Mat source, Mat destination)
    {
        const int analysisEdge = 960;
        var scale = Math.Min(1d, analysisEdge / (double)Math.Max(source.Width, source.Height));
        using var small = new Mat();
        Cv2.Resize(source, small, new Size(Math.Max(1, (int)(source.Width * scale)), Math.Max(1, (int)(source.Height * scale))));
        using var gray = new Mat();
        using var edges = new Mat();
        Cv2.CvtColor(small, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.GaussianBlur(gray, gray, new Size(5, 5), 0);
        Cv2.Canny(gray, edges, 40, 120);
        using var kernel = Cv2.GetStructuringElement(MorphShapes.Rect, new Size(3, 3));
        Cv2.MorphologyEx(edges, edges, MorphTypes.Close, kernel);
        Cv2.FindContours(edges, out Point[][] contours, out _, RetrievalModes.List, ContourApproximationModes.ApproxSimple);
        var area = (double)small.Width * small.Height;
        var candidates = new List<(Point[] Points, double Area, RotatedRect Box)>();
        foreach (var contour in contours.OrderByDescending(c => Math.Abs(Cv2.ContourArea(c))).Take(64))
        {
            var contourArea = Math.Abs(Cv2.ContourArea(contour));
            if (contourArea < area * .12 || contourArea > area * .92) continue;
            var polygon = Cv2.ApproxPolyDP(contour, Cv2.ArcLength(contour, true) * .02, true);
            if (polygon.Length != 4 || !Cv2.IsContourConvex(polygon)) continue;
            // A portrait inset on a tightly framed card is not the card boundary.
            // Leave vertical/strongly rotated frames to the existing orientation path.
            var bounds = Cv2.BoundingRect(polygon);
            if (bounds.Width < bounds.Height * 1.2) continue;
            if (polygon.Any(p => p.X <= 2 || p.Y <= 2 || p.X >= small.Width - 3 || p.Y >= small.Height - 3)) continue;
            var box = Cv2.MinAreaRect(polygon);
            var ratio = Math.Max(box.Size.Width, box.Size.Height) / Math.Min(box.Size.Width, box.Size.Height);
            if (ratio is < 1.35f or > 1.9f || contourArea / (box.Size.Width * box.Size.Height) < .8) continue;
            candidates.Add((polygon, contourArea, box));
        }
        if (candidates.Count == 0) return false;
        var best = candidates[0];
        // Nested contours are the two sides of one border. Distinct cards are ambiguous.
        if (candidates.Skip(1).Any(c => c.Area > best.Area * .7 &&
            c.Box.Center.DistanceTo(best.Box.Center) > Math.Min(best.Box.Size.Width, best.Box.Size.Height) * .25)) return false;
        var points = best.Points.Select(p => new Point2f((float)(p.X / scale), (float)(p.Y / scale))).OrderBy(p => p.X).ToArray();
        var left = points.Take(2).OrderBy(p => p.Y).ToArray();
        var right = points.Skip(2).OrderBy(p => p.Y).ToArray();
        Point2f[] corners = [left[0], right[0], right[1], left[1]];
        var width = (int)Math.Max(corners[0].DistanceTo(corners[1]), corners[3].DistanceTo(corners[2]));
        var height = (int)Math.Max(corners[0].DistanceTo(corners[3]), corners[1].DistanceTo(corners[2]));
        if (width < 200 || height < 120) return false;
        // Preserve sharp source pixels for a straight card instead of introducing
        // subpixel interpolation into small accents and twelve-digit numbers.
        if (Math.Abs(corners[0].Y - corners[1].Y) < 4 / scale &&
            Math.Abs(corners[3].Y - corners[2].Y) < 4 / scale &&
            Math.Abs(corners[0].X - corners[3].X) < 4 / scale &&
            Math.Abs(corners[1].X - corners[2].X) < 4 / scale)
        {
            var x = Math.Max(0, (int)Math.Floor(points.Min(p => p.X)) - 2);
            var y = Math.Max(0, (int)Math.Floor(points.Min(p => p.Y)) - 2);
            var rightEdge = Math.Min(source.Width, (int)Math.Ceiling(points.Max(p => p.X)) + 3);
            var bottom = Math.Min(source.Height, (int)Math.Ceiling(points.Max(p => p.Y)) + 3);
            using var region = new Mat(source, new Rect(x, y, rightEdge - x, bottom - y));
            region.CopyTo(destination);
            return true;
        }
        Point2f[] target = [new(0, 0), new(width - 1, 0), new(width - 1, height - 1), new(0, height - 1)];
        using var transform = Cv2.GetPerspectiveTransform(corners, target);
        Cv2.WarpPerspective(source, destination, transform, new Size(width, height), InterpolationFlags.Linear, BorderTypes.Replicate);
        return true;
    }
}
