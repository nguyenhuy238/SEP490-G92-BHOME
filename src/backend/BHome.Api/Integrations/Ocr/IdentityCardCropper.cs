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
        Cv2.Resize(source, small, new Size(Math.Max(1, (int)(source.Width * scale)), Math.Max(1, (int)(source.Height * scale))), interpolation: InterpolationFlags.Area);
        using var gray = new Mat();
        using var edges = new Mat();
        Cv2.CvtColor(small, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.GaussianBlur(gray, gray, new Size(5, 5), 0);
        Cv2.Canny(gray, edges, 40, 120);
        using var kernel = Cv2.GetStructuringElement(MorphShapes.Rect, new Size(3, 3));
        Cv2.MorphologyEx(edges, edges, MorphTypes.Close, kernel);
        var candidates = Candidates(edges, small.Size(), scale);
        // A blurred, shadowed card can still have a continuous but weak
        // boundary. Keep this pass bounded to the same small analysis frame.
        Cv2.Canny(gray, edges, 12, 36);
        Cv2.MorphologyEx(edges, edges, MorphTypes.Close, kernel);
        candidates.AddRange(Candidates(edges, small.Size(), scale));
        using (var foreground = new Mat())
        {
            // Desk grain may join the card boundary into one frame-sized edge
            // contour. A low-frequency brightness mask gives an independent
            // proposal even when a portrait inset produced a smaller edge box.
            // Both proposals remain subject to the same geometric checks.
            Cv2.GaussianBlur(gray, foreground, new Size(15, 15), 0);
            Cv2.Threshold(foreground, foreground, 0, 255, ThresholdTypes.Binary | ThresholdTypes.Otsu);
            candidates.AddRange(Candidates(foreground, small.Size(), scale));
        }
        {
            // The pale cyan/green chip-card surface can be darker than a bright
            // wood desk. Consider hue proposals even when an edge mask finds a
            // different object, so competing cards cannot be silently ignored.
            using var colour = new Mat();
            Cv2.CvtColor(small, colour, ColorConversionCodes.BGR2HSV);
            Cv2.InRange(colour, new Scalar(35, 20, 45), new Scalar(115, 240, 255), colour);
            using var close = Cv2.GetStructuringElement(MorphShapes.Rect, new Size(15, 15));
            Cv2.MorphologyEx(colour, colour, MorphTypes.Close, close);
            candidates.AddRange(Candidates(colour, small.Size(), scale));
        }
        if (candidates.Count == 0)
        {
            // Local contrast recovery is a last resort for uneven illumination;
            // avoid amplifying background texture when a candidate already exists.
            using var enhanced = new Mat();
            using var clahe = Cv2.CreateCLAHE(2, new Size(8, 8));
            clahe.Apply(gray, enhanced);
            Cv2.Canny(enhanced, edges, 16, 48);
            Cv2.MorphologyEx(edges, edges, MorphTypes.Close, kernel);
            candidates.AddRange(Candidates(edges, small.Size(), scale));
        }
        if (candidates.Count == 0) return false;
        candidates = candidates.OrderByDescending(candidate => candidate.Area).ToList();
        var best = candidates[0];
        // Nested contours are the two sides of one border. Distinct cards are ambiguous.
        if (candidates.Skip(1).Any(c => c.Area > best.Area * .55 &&
            c.Box.Center.DistanceTo(best.Box.Center) > Math.Min(best.Box.Size.Width, best.Box.Size.Height) * .25)) return false;
        var points = best.Points.Select(p => new Point2f((float)(p.X / scale), (float)(p.Y / scale))).ToArray();
        var corners = OrderCorners(points);
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

    private static List<(Point[] Points, double Area, RotatedRect Box)> Candidates(Mat mask, Size frame, double scale)
    {
        Cv2.FindContours(mask, out Point[][] contours, out _, RetrievalModes.List, ContourApproximationModes.ApproxSimple);
        var area = (double)frame.Width * frame.Height;
        var candidates = new List<(Point[] Points, double Area, RotatedRect Box)>();
        foreach (var contour in contours.OrderByDescending(c => Math.Abs(Cv2.ContourArea(c))).Take(64))
        {
            var contourArea = Math.Abs(Cv2.ContourArea(contour));
            // Preserve distant cards with enough actual pixels for OCR, even
            // when they occupy only a small fraction of a portrait photograph.
            if (contourArea < area * .018 || contourArea > area * .92) continue;
            var perimeter = Cv2.ArcLength(contour, true);
            var polygon = Cv2.ApproxPolyDP(contour, perimeter * .02, true);
            if (polygon.Length > 4)
                polygon = Cv2.ApproxPolyDP(contour, perimeter * .03, true);
            if (polygon.Length != 4 || !Cv2.IsContourConvex(polygon)) continue;
            // Reject the portrait inset and the supported back layout's upper
            // right fingerprint panel in a card-shaped frame. Keep centered
            // distant cards in landscape photographs eligible for localization.
            var bounds = Cv2.BoundingRect(polygon);
            var frameRatio = frame.Width / (double)frame.Height;
            if (frameRatio is >= 1.35 and <= 1.9 && contourArea < area * .5 &&
                (bounds.Width < bounds.Height * 1.2 || bounds.X > frame.Width * .45 && bounds.Bottom < frame.Height * .6)) continue;
            if (polygon.Any(p => p.X <= 2 || p.Y <= 2 || p.X >= frame.Width - 3 || p.Y >= frame.Height - 3)) continue;
            var box = Cv2.MinAreaRect(polygon);
            var corners = OrderCorners(polygon.Select(p => new Point2f(p.X, p.Y)).ToArray());
            var top = corners[0].DistanceTo(corners[1]);
            var bottom = corners[3].DistanceTo(corners[2]);
            var left = corners[0].DistanceTo(corners[3]);
            var right = corners[1].DistanceTo(corners[2]);
            if (Math.Max(top, bottom) < Math.Max(90, 200 * scale) ||
                Math.Max(left, right) < Math.Max(55, 120 * scale)) continue;
            var ratio = (top + bottom) / (left + right);
            var fill = contourArea / (box.Size.Width * box.Size.Height);
            var opposingWidth = Math.Min(top, bottom) / Math.Max(top, bottom);
            var opposingHeight = Math.Min(left, right) / Math.Max(left, right);
            // Rectangular cards retain the previous strict shape range. A
            // perspective trapezoid can occupy less of its rotated bounding box,
            // but must have plausible opposite edges and non-extreme angles.
            var rectangular = ratio is >= 1.35 and <= 1.9 && fill >= .8;
            var perspective = ratio is >= 1.22 and <= 2.05 && fill >= .68 &&
                opposingWidth >= .55 && opposingHeight >= .55 &&
                Math.Min(opposingWidth, opposingHeight) <= .88 &&
                HasPlausibleAngles(corners);
            if (!rectangular && !perspective) continue;
            candidates.Add((polygon, contourArea, box));
        }
        return candidates;
    }

    private static bool HasPlausibleAngles(Point2f[] corners)
    {
        for (var i = 0; i < 4; i++)
        {
            var center = corners[i];
            var previous = corners[(i + 3) % 4];
            var next = corners[(i + 1) % 4];
            var dot = (previous.X - center.X) * (next.X - center.X) +
                (previous.Y - center.Y) * (next.Y - center.Y);
            if (Math.Abs(dot) > .6 * previous.DistanceTo(center) * next.DistanceTo(center))
                return false;
        }
        return true;
    }

    internal static Point2f[] OrderCorners(IReadOnlyList<Point2f> points)
    {
        var center = new Point2f(points.Average(p => p.X), points.Average(p => p.Y));
        var cycle = points.OrderBy(p => Math.Atan2(p.Y - center.Y, p.X - center.X)).ToArray();
        double Edge(int index) => cycle[index].DistanceTo(cycle[(index + 1) % 4]);
        var first = Edge(0) + Edge(2) >= Edge(1) + Edge(3) ? 0 : 1;
        var opposite = (first + 2) % 4;
        // Choose the upper of the two long edges; retain cyclic winding so that
        // a steep tilt cannot swap a long edge with the card's short edge.
        if (cycle[first].Y + cycle[(first + 1) % 4].Y > cycle[opposite].Y + cycle[(opposite + 1) % 4].Y)
            first = opposite;
        return Enumerable.Range(0, 4).Select(i => cycle[(first + i) % 4]).ToArray();
    }
}
