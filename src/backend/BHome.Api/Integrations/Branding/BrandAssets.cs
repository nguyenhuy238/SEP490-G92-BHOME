using iText.IO.Image;
using iText.Layout;
using iText.Layout.Element;

namespace BHome.Infrastructure.Branding;

// Embedded in the Infrastructure assembly: no network, storage or working-directory dependency.
internal static class BrandAssets
{
    internal const string MarkResource = "BHome.Branding.bhome-mark.png";
    private static readonly Lazy<byte[]?> Mark = new(() => ReadMark(
        () => typeof(BrandAssets).Assembly.GetManifestResourceStream(MarkResource)));

    internal static byte[]? MarkPng => Mark.Value;

    internal static byte[]? ReadMark(Func<Stream?> open)
    {
        try
        {
            using var stream = open();
            if (stream is null) return null;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            var bytes = buffer.ToArray();
            return bytes.Length is > 8 and <= 256 * 1024 &&
                bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
                ? bytes : null;
        }
        catch (IOException)
        {
            // Branding is optional; the existing text wordmark remains available.
            return null;
        }
    }

    internal static void AddPdfMark(Document document, float left, float bottom, float size, byte[]? png)
    {
        if (png is null) return;
        Image image;
        try
        {
            image = new Image(ImageDataFactory.Create(png));
        }
        catch (Exception error) when (error is ArgumentException or IOException or iText.IO.Exceptions.IOException)
        {
            return;
        }
        // Fixed margin placement has no impact on content flow or signature coordinates.
        document.Add(image.ScaleToFit(size, size).SetFixedPosition(1, left, bottom));
    }
}
