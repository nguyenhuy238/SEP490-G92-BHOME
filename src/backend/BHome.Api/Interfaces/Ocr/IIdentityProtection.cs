namespace BHome.Application.Ocr;

public sealed record EncryptedIdentity(string Ciphertext, string Nonce, string Tag, string KeyVersion)
{
    public override string ToString() => "Encrypted identity (payload omitted)";
}

// All scope values must be server-loaded after business authorization, never supplied by the UI.
public sealed record IdentityProtectionScope(Guid OwnerId, Guid ResidentId);
public sealed record IdentityMatchIndex(string Digest, string KeyVersion);

public interface IIdentityProtection
{
    EncryptedIdentity Encrypt(ReadOnlySpan<byte> confirmedIdentityJson, IdentityProtectionScope scope);
    byte[] Decrypt(EncryptedIdentity envelope, IdentityProtectionScope scope);
    IdentityMatchIndex CreateMatchIndex(string confirmedCitizenNumber, Guid ownerId);
    IReadOnlyList<IdentityMatchIndex> CreateMatchIndexes(string confirmedCitizenNumber, Guid ownerId);
}
