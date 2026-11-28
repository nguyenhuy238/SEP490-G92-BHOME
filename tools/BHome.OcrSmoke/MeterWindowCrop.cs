using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class MeterWindowCrop
{
    // Canonical long axis; no forced thresholding, invented digits or padding by
    // expected digit count. Margins are measured in observed window height.
    public static Mat Create(Mat image, RotatedRect region, float marginX = .3f, float marginY = .15f)
    {
        var width = region.Size.Width; var height = region.Size.Height; var angle = region.Angle;
        if (width < height) { (width, height) = (height, width); angle += 90; }
        while (angle >= 90) angle -= 180;
        while (angle < -90) angle += 180;
        var w = width + 2 * height * marginX; var h = height * (1 + 2 * marginY);
        var radians = angle * MathF.PI / 180;
        var dx = new Point2f(MathF.Cos(radians) * w / 2, MathF.Sin(radians) * w / 2);
        var dy = new Point2f(-MathF.Sin(radians) * h / 2, MathF.Cos(radians) * h / 2);
        Point2f[] corners = [region.Center - dx - dy, region.Center + dx - dy, region.Center + dx + dy, region.Center - dx + dy];
        // A requested margin outside the image is not evidence of a missing digit.
        // Replicate only that margin; scene selection already checks window bounds.
        var size = new Size(Math.Max(2, (int)w), Math.Max(2, (int)h));
        Point2f[] destination = [new(0, 0), new(size.Width - 1, 0), new(size.Width - 1, size.Height - 1), new(0, size.Height - 1)];
        using var transform = Cv2.GetPerspectiveTransform(corners, destination);
        var result = new Mat();
        Cv2.WarpPerspective(image, result, transform, size, InterpolationFlags.Linear, BorderTypes.Replicate);
        return result;
    }
}
