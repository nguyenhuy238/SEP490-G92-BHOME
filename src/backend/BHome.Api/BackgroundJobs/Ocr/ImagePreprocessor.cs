using System.Buffers.Binary;
using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

public interface IImagePreprocessor
{
    PreparedImage Prepare(ReadOnlyMemory<byte> bytes, OcrDocumentKind kind);
    PreparedImage PrepareUnclassified(ReadOnlyMemory<byte> bytes) => throw new InvalidDataException("Neutral preprocessing unavailable.");
}

public sealed class PreparedImage(Mat image, IReadOnlyList<string> warnings) : IDisposable
{
    public Mat Image { get; } = image;
    public IReadOnlyList<string> Warnings { get; } = warnings;
    public void Dispose() { Image.SetTo(Scalar.All(0)); Image.Dispose(); }
}

public sealed class ImagePreprocessor(OcrOptions options) : IImagePreprocessor
{
    public PreparedImage Prepare(ReadOnlyMemory<byte> bytes, OcrDocumentKind kind)
    {
        if (!Enum.IsDefined(kind)) throw new OcrInputException("unsupported_profile");
        return Prepare(bytes, options.Profiles[kind], kind);
    }

    public PreparedImage PrepareUnclassified(ReadOnlyMemory<byte> bytes) => Prepare(bytes, options.AutomaticProfile);

    private PreparedImage Prepare(ReadOnlyMemory<byte> bytes, ImageProfile profile, OcrDocumentKind? kind = null)
    {
        var identity = kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack;
        ValidateHeader(bytes.Span, options.MaxImageBytes, options.MaxPixels);
        using var source = Cv2.ImDecode(bytes.Span, ImreadModes.Color);
        if (source.Empty()) throw new OcrInputException("corrupted_image");
        if ((long)source.Width * source.Height > options.MaxPixels) throw new OcrInputException("image_dimensions");
        var result = new Mat();
        var warnings = new List<string>();
        try
        {
            if (profile.ClockwiseQuarterTurns == 0) source.CopyTo(result);
            else Cv2.Rotate(source, result, profile.ClockwiseQuarterTurns switch
            {
                1 => RotateFlags.Rotate90Clockwise,
                2 => RotateFlags.Rotate180,
                _ => RotateFlags.Rotate90Counterclockwise
            });
            // Locate the card before downscaling so background text cannot consume
            // the identity recognition budget and small card text keeps its detail.
            if (identity)
            {
                using var card = new Mat();
                if (IdentityCardCropper.TryCrop(result, card))
                {
                    card.CopyTo(result);
                    if (card.Width < 640) warnings.Add("identity_small_card");
                }
                else if (result.Width / (double)result.Height is < 1.35 or > 1.9) warnings.Add("identity_card_not_found");
            }
            var ratio = Math.Min(1d, (double)options.MaxDimension / Math.Max(result.Width, result.Height));
            if (ratio < 1) Cv2.Resize(result, result, new Size(Math.Max(1, (int)(result.Width * ratio)),
                Math.Max(1, (int)(result.Height * ratio))), 0, 0, InterpolationFlags.Area);
            // Short bilingual labels in a distant phone photo can be only a few
            // pixels tall. Put a localized card into a consistent detector scale;
            // this resamples observed pixels and does not reconstruct missing text.
            // Back-side layouts retain their scale: enlarging MRZ/decorative text
            // did not improve issue-date extraction within the container deadline.
            var identityWidth = Math.Min(1200, options.MaxDimension);
            if (kind == OcrDocumentKind.IdentityFront && result.Width / (double)result.Height is >= 1.35 and <= 1.9 && result.Width < identityWidth)
            {
                // Keep the existing sampling for modest enlargement. A larger
                // distant-card enlargement needs more support for small accents.
                var interpolation = identityWidth / (double)result.Width > 2.25 ? InterpolationFlags.Lanczos4 : InterpolationFlags.Cubic;
                Cv2.Resize(result, result, new Size(identityWidth, (int)Math.Round(result.Height * (double)identityWidth / result.Width)), 0, 0, interpolation);
            }
            using var gray = new Mat();
            Cv2.CvtColor(result, gray, ColorConversionCodes.BGR2GRAY);
            if (identity && Cv2.Mean(gray).Val0 < 75) warnings.Add("identity_low_light");
            if (identity && result.Width / (double)result.Height is >= 1.35 and <= 1.9 && Cv2.Mean(gray).Val0 < 110)
            {
                // Lift observed shadows on a localized/tightly framed card.
                // Keep colour and avoid a hard threshold that erases accents.
                using var lut = new Mat(1, 256, MatType.CV_8UC1);
                for (var value = 0; value < 256; value++)
                    lut.Set(0, value, (byte)Math.Round(255 * Math.Pow(value / 255d, .85)));
                Cv2.LUT(result, lut, result);
                Cv2.CvtColor(result, gray, ColorConversionCodes.BGR2GRAY);
            }
            using var laplacian = new Mat();
            Cv2.Laplacian(gray, laplacian, MatType.CV_64F);
            Cv2.MeanStdDev(laplacian, out _, out var deviation);
            if (deviation.Val0 * deviation.Val0 < profile.MinLaplacianVariance) warnings.Add("blur_or_low_detail");
            using var highlights = new Mat();
            Cv2.InRange(gray, new Scalar(250), new Scalar(255), highlights);
            // Advisory only: a white background also triggers this heuristic.
            if ((double)Cv2.CountNonZero(highlights) / (gray.Width * gray.Height) > .35) warnings.Add("possible_glare");
            if (profile.EnhanceContrast)
            {
                using var clahe = Cv2.CreateCLAHE(2, new Size(8, 8));
                clahe.Apply(gray, gray);
            }
            if (profile.Denoise) Cv2.MedianBlur(gray, gray, 3);
            if (profile.Threshold) Cv2.AdaptiveThreshold(gray, gray, 255, AdaptiveThresholdTypes.GaussianC, ThresholdTypes.Binary, 31, 11);
            if (profile.EnhanceContrast || profile.Denoise || profile.Threshold) Cv2.CvtColor(gray, result, ColorConversionCodes.GRAY2BGR);
            return new PreparedImage(result, warnings);
        }
        catch { result.Dispose(); throw; }
    }

    // Inspect dimensions before native decoding, including JPEG SOF, to bound decompression allocation.
    public static void ValidateHeader(ReadOnlySpan<byte> bytes, int maxBytes, int maxPixels)
    {
        if (bytes.Length == 0) throw new OcrInputException("missing_image");
        if (bytes.Length > maxBytes) throw new OcrInputException("image_too_large");
        int width = 0, height = 0;
        if (bytes.Length >= 24 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) &&
            bytes.Slice(12, 4).SequenceEqual("IHDR"u8))
        {
            width = BinaryPrimitives.ReadInt32BigEndian(bytes[16..20]);
            height = BinaryPrimitives.ReadInt32BigEndian(bytes[20..24]);
        }
        else if (bytes.Length >= 4 && bytes[0] == 255 && bytes[1] == 216)
        {
            for (var offset = 2; offset + 4 <= bytes.Length;)
            {
                if (bytes[offset++] != 255) break;
                while (offset < bytes.Length && bytes[offset] == 255) offset++;
                if (offset >= bytes.Length) break;
                var marker = bytes[offset++];
                if (marker is 0xD9 or 0xDA) break;
                if (marker is 0xD8 or 0x01 or >= 0xD0 and <= 0xD7) continue;
                if (offset + 2 > bytes.Length) break;
                int length = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset, 2));
                if (length < 2 || offset + length > bytes.Length) break;
                if (marker is >= 0xC0 and <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC) && length >= 7)
                {
                    height = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 3, 2));
                    width = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 5, 2)); break;
                }
                offset += length;
            }
        }
        else throw new OcrInputException("unsupported_image_format");
        if (width <= 0 || height <= 0 || (long)width * height > maxPixels || width > 16000 || height > 16000)
            throw new OcrInputException("image_dimensions");
    }
}
