using BHome.Application.Ocr;
using OpenCvSharp;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using ZXing;
using ZXing.Common;

namespace BHome.Infrastructure.Ocr;

internal static class IdentityQrReader
{
    public static IReadOnlyList<IdentityFieldObservation> Read(Mat source, CancellationToken token = default, bool cornerOnly = false)
    {
        // Both detection and decoding are local. Only supported structured values
        // leave this adapter; URLs, payloads and decoder errors are never logged.
        token.ThrowIfCancellationRequested();
        if (source.Width / (double)source.Height is < 1.35 or > 1.9)
            return cornerOnly ? [] : Decode(source);
        using var corner = new Mat(source, new Rect((int)(source.Width * .72), 0, (int)(source.Width * .28), (int)(source.Height * .36)));
        using var enlarged = new Mat();
        try
        {
            var observations = Decode(corner);
            if (observations.Count > 0 || cornerOnly) return observations;
            token.ThrowIfCancellationRequested();
            // Keep the retry bounded even for a high-resolution image.
            var scale = Math.Min(3d, 768d / Math.Max(corner.Width, corner.Height));
            Cv2.Resize(corner, enlarged, new Size(), scale, scale, InterpolationFlags.Nearest);
            Cv2.CopyMakeBorder(enlarged, enlarged, 16, 16, 16, 16, BorderTypes.Constant, Scalar.White);
            observations = Decode(enlarged);
            if (observations.Count > 0) return observations;
            token.ThrowIfCancellationRequested();
            Cv2.CvtColor(enlarged, enlarged, ColorConversionCodes.BGR2GRAY);
            Cv2.AdaptiveThreshold(enlarged, enlarged, 255, AdaptiveThresholdTypes.GaussianC, ThresholdTypes.Binary, 31, 7);
            observations = Decode(enlarged);
            if (observations.Count > 0) return observations;
            token.ThrowIfCancellationRequested();
            return Decode(source);
        }
        finally { if (!enlarged.Empty()) enlarged.SetTo(Scalar.All(0)); }
    }

    private static IReadOnlyList<IdentityFieldObservation> Decode(Mat source)
    {
        using var gray = new Mat();
        if (source.Channels() == 1) source.CopyTo(gray);
        else Cv2.CvtColor(source, gray, ColorConversionCodes.BGR2GRAY);
        var pixels = new byte[checked(gray.Width * gray.Height)];
        Result? result = null;
        try
        {
            for (var row = 0; row < gray.Height; row++) Marshal.Copy(gray.Ptr(row), pixels, row * gray.Width, gray.Width);
            var reader = new BarcodeReaderGeneric
            {
                Options = new DecodingOptions { TryHarder = true, PossibleFormats = [BarcodeFormat.QR_CODE] }
            };
            result = reader.Decode(new RGBLuminanceSource(pixels, gray.Width, gray.Height, RGBLuminanceSource.BitmapFormat.Gray8));
            return result is null ? [] : IdentityOcrEvidence.ParseQr(result.Text);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(pixels);
            if (result?.RawBytes is { } raw) CryptographicOperations.ZeroMemory(raw);
            if (result?.ResultMetadata is { } metadata && metadata.TryGetValue(ResultMetadataType.BYTE_SEGMENTS, out var segmentData) &&
                segmentData is IEnumerable<byte[]> segments)
                foreach (var segment in segments) CryptographicOperations.ZeroMemory(segment);
            gray.SetTo(Scalar.All(0));
        }
    }
}
