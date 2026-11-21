using System.Security.Cryptography.X509Certificates;

namespace BHome.DigitalSigning.Application;

// One remote-signing CA. Talks only in raw hashes and raw signatures; everything PDF-shaped belongs to IPdfSigner.
// providerUserId is the signer's subscriber id at the CA (Viettel MySign: the user_id Viettel issued, e.g. CCCD/MST).
public interface ISigningProvider
{
    string Code { get; }

    // serialNumber narrows to one certificate when the subscriber has several; null lists them all.
    Task<IReadOnlyList<RemoteCredential>> ListCredentialsAsync(string providerUserId, string? serialNumber,
        CancellationToken cancellationToken);

    // Sends a hash to be signed and returns the CA's transaction id. Does not wait for the phone confirmation.
    Task<string> RequestSignatureAsync(SignHashRequest request, CancellationToken cancellationToken);

    Task<SignStatus> GetStatusAsync(string providerUserId, string providerTransactionId, CancellationToken cancellationToken);

    // Whether the CA accepts the configured account for this subscriber: null when it does, else the reason. Signs nothing.
    Task<string?> CheckAccountAsync(string providerUserId, CancellationToken cancellationToken);
}

public sealed record RemoteCredential(
    string SerialNumber, X509Certificate2 Certificate, IReadOnlyList<X509Certificate2> Chain, string CredentialId);

// Digest is SHA-256 of what must be signed; DocumentId and Description are shown on the signer's phone.
public sealed record SignHashRequest(
    string ProviderUserId, string CredentialId, byte[] Digest, string DocumentId, string Description);

public abstract record SignStatus
{
    public sealed record Pending : SignStatus;
    public sealed record Signed(byte[] RawSignature) : SignStatus;
    public sealed record Rejected(string Reason) : SignStatus;
    public sealed record Expired : SignStatus;
    public sealed record Failed(string Code, string Message) : SignStatus;
}
