using System.Buffers.Binary;
using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

public interface IImagePreprocessor
{
    PreparedImage Prepare(ReadOnlyMemory<byte> bytes, OcrDocumentKind kind);
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
        ValidateHeader(bytes.Span, options.MaxImageBytes, options.MaxPixels);
        using var source = Cv2.ImDecode(bytes.Span, ImreadModes.Color);
        if (source.Empty()) throw new OcrInputException("corrupted_image");
        if ((long)source.Width * source.Height > options.MaxPixels) throw new OcrInputException("image_dimensions");
        var profile = options.Profiles[kind];
        var result = new Mat();
        try
        {
            if (profile.ClockwiseQuarterTurns == 0) source.CopyTo(result);
            else Cv2.Rotate(source, result, profile.ClockwiseQuarterTurns switch
            {
                1 => RotateFlags.Rotate90Clockwise,
                2 => RotateFlags.Rotate180,
                _ => RotateFlags.Rotate90Counterclockwise
            });
            var ratio = Math.Min(1d, (double)options.MaxDimension / Math.Max(result.Width, result.Height));
            if (ratio < 1) Cv2.Resize(result, result, new Size(Math.Max(1, (int)(result.Width * ratio)),
                Math.Max(1, (int)(result.Height * ratio))), 0, 0, InterpolationFlags.Area);
            using var gray = new Mat();
            Cv2.CvtColor(result, gray, ColorConversionCodes.BGR2GRAY);
            using var laplacian = new Mat();
            Cv2.Laplacian(gray, laplacian, MatType.CV_64F);
            Cv2.MeanStdDev(laplacian, out _, out var deviation);
            var warnings = new List<string>();
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
