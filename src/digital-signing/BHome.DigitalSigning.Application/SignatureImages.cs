using System.Buffers.Binary;

namespace BHome.DigitalSigning.Application;

// A signer's picture, drawn where they place their signature on the page (a transparent PNG, so it sits over the text).
public sealed record SignatureImage(byte[] Content, int Width, int Height, string Sha256, DateTimeOffset UpdatedAt);

public interface ISignatureImageStore
{
    Task<SignatureImage?> FindAsync(Guid ownerUserId, CancellationToken cancellationToken);
    Task SaveAsync(Guid ownerUserId, SignatureImage image, CancellationToken cancellationToken);
    Task DeleteAsync(Guid ownerUserId, CancellationToken cancellationToken);
}

// Reads what is needed from the PNG header itself, so the application layer needs no imaging library.
internal static class PngHeader
{
    private static readonly byte[] Magic = [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A];

    public static bool IsPng(ReadOnlySpan<byte> content) => content.Length >= 33 && content[..8].SequenceEqual(Magic);

    // IHDR is always the first chunk: width and height are big-endian at bytes 16 and 20, the colour type at 25.
    public static (int Width, int Height) Size(ReadOnlySpan<byte> content) =>
        ((int)BinaryPrimitives.ReadUInt32BigEndian(content[16..]), (int)BinaryPrimitives.ReadUInt32BigEndian(content[20..]));

    // Colour types 4 (grey + alpha) and 6 (RGBA) carry alpha; any other type has transparency only with a tRNS chunk.
    public static bool HasTransparency(ReadOnlySpan<byte> content)
    {
        if (content[25] is 4 or 6) return true;
        var offset = 8;
        while (offset + 8 <= content.Length)
        {
            var length = (int)BinaryPrimitives.ReadUInt32BigEndian(content[offset..]);
            var type = content.Slice(offset + 4, 4);
            if (type.SequenceEqual("tRNS"u8)) return true;
            if (type.SequenceEqual("IDAT"u8) || length < 0) return false;
            offset += 12 + length;
        }
        return false;
    }
}
