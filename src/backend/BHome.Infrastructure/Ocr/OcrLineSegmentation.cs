using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class OcrLineSegmentation
{
    public static bool TryWordBoundary(Mat crop, out int split)
    {
        split = 0;
        using var gray = new Mat();
        using var mask = new Mat();
        Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.Threshold(gray, mask, 0, 255, ThresholdTypes.BinaryInv | ThresholdTypes.Otsu);
        if (Cv2.CountNonZero(mask) > mask.Total() / 2) Cv2.BitwiseNot(mask, mask);
        var columns = new int[mask.Width];
        var top = mask.Height; var bottom = -1;
        for (var y = 0; y < mask.Height; y++)
            for (var x = 0; x < mask.Width; x++)
                if (mask.At<byte>(y, x) != 0)
                { columns[x]++; top = Math.Min(top, y); bottom = Math.Max(bottom, y); }
        var glyphHeight = bottom - top + 1;
        if (glyphHeight < 4) return false;
        var bestDistance = double.MaxValue;
        for (var x = mask.Width / 4; x < mask.Width * 3 / 4; x++)
        {
            if (columns[x] > 0) continue;
            var start = x;
            while (x < mask.Width && columns[x] == 0) x++;
            var center = (start + x) / 2;
            if (x - start < Math.Max(3, glyphHeight * .18) || center > mask.Width * 3 / 4) continue;
            var distance = Math.Abs(center - mask.Width / 2d);
            if (distance >= bestDistance) continue;
            bestDistance = distance; split = center;
        }
        return split > 0;
    }
}
