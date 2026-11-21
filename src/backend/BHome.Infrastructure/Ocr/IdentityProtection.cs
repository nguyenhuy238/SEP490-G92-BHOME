using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BHome.Application.Ocr;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Ocr;

public sealed class IdentityProtectionOptions
{
    public string ActiveEncryptionVersion { get; set; } = "";
    public string ActiveHmacVersion { get; set; } = "";
    public Dictionary<string, string> EncryptionKeys { get; set; } = [];
    public Dictionary<string, string> HmacKeys { get; set; } = [];
}

// Primitive only: does not grant access, load identities, define verification or persist anything.
public sealed class IdentityProtection(IOptions<IdentityProtectionOptions> options) : IIdentityProtection
{
    public EncryptedIdentity Encrypt(ReadOnlySpan<byte> confirmedIdentityJson, IdentityProtectionScope scope)
    {
        ValidateScope(scope);
        if (confirmedIdentityJson.IsEmpty || confirmedIdentityJson.Length > 16 * 1024)
            throw new ArgumentException("Identity payload size is invalid.");
        var version = options.Value.ActiveEncryptionVersion;
        var key = EncryptionKey(version);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[confirmedIdentityJson.Length];
        var tag = new byte[16];
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(nonce, confirmedIdentityJson, cipher, tag, Aad(scope, version));
            return new(Convert.ToBase64String(cipher), Convert.ToBase64String(nonce), Convert.ToBase64String(tag), version);
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    public byte[] Decrypt(EncryptedIdentity envelope, IdentityProtectionScope scope)
    {
        ValidateScope(scope);
        if (envelope.Ciphertext.Length > 22000 || envelope.Nonce.Length != 16 || envelope.Tag.Length != 24)
            throw new CryptographicException("Invalid identity envelope.");
        var key = EncryptionKey(envelope.KeyVersion);
        byte[]? plain = null;
        try
        {
            var cipher = Convert.FromBase64String(envelope.Ciphertext);
            var nonce = Convert.FromBase64String(envelope.Nonce);
            var tag = Convert.FromBase64String(envelope.Tag);
            if (nonce.Length != 12 || tag.Length != 16 || cipher.Length is 0 or > 16384)
                throw new CryptographicException("Invalid identity envelope.");
            plain = new byte[cipher.Length];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, cipher, tag, plain, Aad(scope, envelope.KeyVersion));
            return plain; // authorized caller must clear this array after use
        }
        catch (FormatException) { throw new CryptographicException("Invalid identity envelope."); }
        catch
        {
            if (plain is not null) CryptographicOperations.ZeroMemory(plain);
            throw;
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    public IdentityMatchIndex CreateMatchIndex(string confirmedCitizenNumber, Guid ownerId)
        => MatchIndex(confirmedCitizenNumber, ownerId, options.Value.ActiveHmacVersion);

    public IReadOnlyList<IdentityMatchIndex> CreateMatchIndexes(string confirmedCitizenNumber, Guid ownerId)
        => options.Value.HmacKeys.Keys.Select(version => MatchIndex(confirmedCitizenNumber, ownerId, version)).ToArray();

    private IdentityMatchIndex MatchIndex(string confirmedCitizenNumber, Guid ownerId, string version)
    {
        if (ownerId == Guid.Empty) throw new ArgumentException("Identity scope is required.");
        // Trim only; do not reinterpret OCR O/0, Unicode digits or internal punctuation as a real ID.
        var normalized = confirmedCitizenNumber.Trim();
        if (normalized.Length != 12 || normalized.Any(c => c is < '0' or > '9'))
            throw new ArgumentException("Citizen number must contain 12 ASCII digits.");
        var key = ReadKey(options.Value.HmacKeys, version);
        byte[]? data = null;
        try
        {
            foreach (var encryptionVersion in options.Value.EncryptionKeys.Keys)
            {
                var encryptionKey = ReadKey(options.Value.EncryptionKeys, encryptionVersion);
                try
                {
                    if (CryptographicOperations.FixedTimeEquals(key, encryptionKey))
                        throw new InvalidOperationException("Identity encryption and matching require separate keys.");
                }
                finally { CryptographicOperations.ZeroMemory(encryptionKey); }
            }
            data = Encoding.UTF8.GetBytes($"bhome:identity-match:v1:{ownerId:N}:{normalized}");
            return new(Convert.ToHexString(HMACSHA256.HashData(key, data)), version);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            if (data is not null) CryptographicOperations.ZeroMemory(data);
        }
    }

    private byte[] EncryptionKey(string version)
    {
        var key = ReadKey(options.Value.EncryptionKeys, version);
        try
        {
            foreach (var hmacVersion in options.Value.HmacKeys.Keys)
            {
                var hmac = ReadKey(options.Value.HmacKeys, hmacVersion);
                try
                {
                    if (CryptographicOperations.FixedTimeEquals(key, hmac))
                        throw new InvalidOperationException("Identity encryption and matching require separate keys.");
                }
                finally { CryptographicOperations.ZeroMemory(hmac); }
            }
            return key;
        }
        catch { CryptographicOperations.ZeroMemory(key); throw; }
    }

    private static byte[] ReadKey(Dictionary<string, string> keys, string version)
    {
        if (!Regex.IsMatch(version, @"\A[a-zA-Z0-9_-]{1,32}\z", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)) ||
            !keys.TryGetValue(version, out var encoded)) throw new InvalidOperationException("Identity key version unavailable.");
        byte[] key;
        try { key = Convert.FromBase64String(encoded); }
        catch (FormatException) { throw new InvalidOperationException("Identity key configuration is invalid."); }
        if (key.Length == 32) return key;
        CryptographicOperations.ZeroMemory(key);
        throw new InvalidOperationException("Identity keys must be 256 bits.");
    }

    private static void ValidateScope(IdentityProtectionScope scope)
    {
        if (scope.OwnerId == Guid.Empty || scope.ResidentId == Guid.Empty)
            throw new ArgumentException("Identity scope is required.");
    }

    private static byte[] Aad(IdentityProtectionScope scope, string version)
        => Encoding.UTF8.GetBytes($"bhome:identity-envelope:v1:{scope.OwnerId:N}:{scope.ResidentId:N}:{version}");
}
