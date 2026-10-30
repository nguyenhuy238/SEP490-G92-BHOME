using System.Security.Cryptography;
using System.Text;
using BHome.DigitalSigning.Application;

namespace BHome.DigitalSigning.Infrastructure.Security;

// AES-256-GCM, stored as Base64(nonce[12] || ciphertext || tag[16]) under a key derived from DigitalSigning:SecretKey.
// The same layout the Java system used, so a secret saved there decrypts here under the same key.
internal sealed class AesGcmSecretProtector : ISecretProtector
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private readonly byte[]? key;

    public AesGcmSecretProtector(string? secretKey)
    {
        // Kept apart from keys other modules may derive from the same material.
        key = string.IsNullOrWhiteSpace(secretKey) || secretKey.Length < 32
            ? null
            : SHA256.HashData(Encoding.UTF8.GetBytes(secretKey + ".signing.v1"));
    }

    public string Protect(string value)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var plain = Encoding.UTF8.GetBytes(value);
        var packed = new byte[NonceSize + plain.Length + TagSize];
        nonce.CopyTo(packed, 0);
        using var aes = new AesGcm(RequireKey(), TagSize);
        aes.Encrypt(nonce, plain, packed.AsSpan(NonceSize, plain.Length), packed.AsSpan(NonceSize + plain.Length, TagSize));
        return Convert.ToBase64String(packed);
    }

    public string Unprotect(string protectedValue)
    {
        try
        {
            var packed = Convert.FromBase64String(protectedValue);
            if (packed.Length <= NonceSize + TagSize) throw new SecretUnreadableException("The stored secret is truncated.");
            var cipherLength = packed.Length - NonceSize - TagSize;
            var plain = new byte[cipherLength];
            using var aes = new AesGcm(RequireKey(), TagSize);
            aes.Decrypt(packed.AsSpan(0, NonceSize), packed.AsSpan(NonceSize, cipherLength),
                packed.AsSpan(NonceSize + cipherLength, TagSize), plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception failure) when (failure is FormatException or CryptographicException)
        {
            throw new SecretUnreadableException("The stored secret cannot be decrypted (the secret key changed?).", failure);
        }
    }

    // No built-in fallback key: a deployment that stores secrets must supply its own.
    private byte[] RequireKey() => key ?? throw new InvalidOperationException(
        "Configure DigitalSigning:SecretKey (at least 32 random characters) before saving a signing secret.");
}
