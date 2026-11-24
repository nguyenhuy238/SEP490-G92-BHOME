using System.Security.Cryptography;
using BHome.Application.Contracts;

namespace BHome.Application.Storage;

// Shared mechanics only. Calling services remain responsible for resource-level
// authorization, object keys, idempotency, retention and financial transitions.
public sealed record PrivateImageContent(byte[] Bytes, string ContentType, string Sha256)
{
    public int Length => Bytes.Length;
}

public sealed class PrivateImageTooLargeException : Exception { }
public sealed class PrivateImageIntegrityException : Exception { }

public static class PrivateImageEvidence
{
    public const int MaximumBytes = 5 * 1024 * 1024;

    public static async Task<PrivateImageContent> ReadValidatedAsync(Stream input, IContractImageValidator images,
        CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var count = await input.ReadAsync(block, token);
            if (count == 0) break;
            if (buffer.Length + count > MaximumBytes) throw new PrivateImageTooLargeException();
            await buffer.WriteAsync(block.AsMemory(0, count), token);
        }
        var bytes = buffer.ToArray();
        try
        {
            // The validator uses decoded bytes, not a user-supplied MIME header.
            var type = images.Validate(bytes);
            return new(bytes, type, Convert.ToHexString(SHA256.HashData(bytes)));
        }
        catch
        {
            CryptographicOperations.ZeroMemory(bytes);
            throw;
        }
    }

    public static async Task PutVerifiedAsync(IObjectStorage storage, string objectKey, PrivateImageContent image,
        CancellationToken token)
    {
        using var source = new MemoryStream(image.Bytes, writable: false);
        await storage.PutAsync(objectKey, source, image.Length, image.ContentType, token);
        await CopyVerifiedAsync(storage, objectKey, image.Length, image.Sha256, Stream.Null, token);
    }

    public static async Task CopyVerifiedAsync(IObjectStorage storage, string objectKey, long length, string sha256,
        Stream output, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(objectKey, buffer, token);
        try
        {
            if (buffer.Length != length ||
                !string.Equals(Convert.ToHexString(SHA256.HashData(
                    buffer.GetBuffer().AsSpan(0, checked((int)buffer.Length)))), sha256, StringComparison.OrdinalIgnoreCase))
                throw new PrivateImageIntegrityException();
            buffer.Position = 0;
            await buffer.CopyToAsync(output, token);
        }
        finally { CryptographicOperations.ZeroMemory(buffer.GetBuffer().AsSpan(0, checked((int)buffer.Length))); }
    }
}
