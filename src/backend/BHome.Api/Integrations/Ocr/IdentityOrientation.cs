using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal static class IdentityOrientation
{
    public static RotatedRect? Probe(IEnumerable<RotatedRect> regions) => regions
        // One trained 640px bucket: exclude short numeric strings and long MRZ.
        .Where(r => Math.Max(r.Size.Width, r.Size.Height) / Math.Min(r.Size.Width, r.Size.Height) is > 6.7f and <= 13.3f)
        .OrderByDescending(r => Math.Min(r.Size.Width, r.Size.Height))
        .Select(r => (RotatedRect?)r).FirstOrDefault();

    public static bool Reliable(OcrLine line) => line.Confidence >= .92f && HasLetters(line);

    public static bool PreferReversed(OcrLine original, OcrLine reversed) => HasLetters(reversed) &&
        reversed.Confidence >= .85f && reversed.Confidence >= original.Confidence + .1f;

    private static bool HasLetters(OcrLine line) => !line.Text.Contains('<') && line.Text.Count(char.IsLetter) >= 3;
}
