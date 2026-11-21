using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class MeterDisplaySplitter
{
    public static Mat PrepareSegment(Mat crop)
    {
        using var mask = Foreground(crop);
        using var points = new Mat();
        Cv2.FindNonZero(mask, points);
        if (points.Empty()) return crop.Clone();
        var bounds = Cv2.BoundingRect(points);
        using var content = new Mat(crop, bounds);
        var padding = Math.Max(2, (int)Math.Ceiling(bounds.Height * .15));
        var result = new Mat();
        // Keep the observed foreground/background colours (LCD can be light on dark).
        var background = crop.At<Vec3b>(0, 0);
        Cv2.CopyMakeBorder(content, result, padding, padding, padding, padding, BorderTypes.Constant,
            new Scalar(background.Item0, background.Item1, background.Item2));
        return result;
    }

    private static Mat Foreground(Mat crop)
    {
        using var gray = new Mat();
        var mask = new Mat();
        Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.Threshold(gray, mask, 0, 255, ThresholdTypes.BinaryInv | ThresholdTypes.Otsu);
        if (Cv2.CountNonZero(mask) > mask.Width * mask.Height / 2) Cv2.BitwiseNot(mask, mask);
        return mask;
    }

    // Whitespace separates the displayed quantity from its unit. Never derive decimal places
    // from digit colour, meter type or the number of wheels.
    public static bool TrySplit(Mat crop, out int split)
    {
        split = 0;
        using var mask = Foreground(crop);
        var columns = new int[mask.Width];
        var top = mask.Height; var bottom = -1;
        for (var y = 0; y < mask.Height; y++)
            for (var x = 0; x < mask.Width; x++)
                if (mask.At<byte>(y, x) != 0)
                { columns[x]++; top = Math.Min(top, y); bottom = Math.Max(bottom, y); }
        var glyphHeight = bottom - top + 1;
        if (glyphHeight < 4) return false;
        var first = Array.FindIndex(columns, c => c > 0);
        var last = Array.FindLastIndex(columns, c => c > 0);
        var bestGap = 0;
        for (var x = first; x < last; x++)
        {
            if (columns[x] != 0) continue;
            var start = x;
            while (x < last && columns[x] == 0) x++;
            var gap = x - start;
            if (gap <= bestGap || gap < glyphHeight * .35 ||
                start - first < glyphHeight * 1.5 || last - x < glyphHeight * .3) continue;
            bestGap = gap;
            split = (start + x) / 2;
        }
        return split > 0;
    }
}
